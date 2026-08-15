import React, { useState, useEffect, useCallback } from 'react';
import { NavPage } from '../types';
import { useApp } from '../context/AppContext';
import { PageHeader } from '../components/Shared';

interface QuizAnswer { text: string; correct: boolean; }

interface Quiz {
  id: string;
  channel_id: string;
  question: string;
  answers: QuizAnswer[];
  prize_code: string;
  status: 'active' | 'won' | 'cancelled';
  winner_username: string | null;
  created_at: string;
  won_at: string | null;
  message_id: number | null;
}

const LETTERS = ['A','B','C','D','E','F','G','H'];

function makeAnswer(correct = false): QuizAnswer { return { text: '', correct }; }

function statusBadge(status: Quiz['status']) {
  if (status === 'active')    return <span style={{ background: 'var(--a1)', color: '#fff', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Attivo</span>;
  if (status === 'won')       return <span style={{ background: '#22c55e', color: '#fff', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Vinto</span>;
  if (status === 'cancelled') return <span style={{ background: 'var(--t3)', color: '#fff', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Annullato</span>;
  return null;
}

export function QuizPage({ nav }: { nav: (p: NavPage) => void }) {
  const { allChannels, activeProfileId } = useApp();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [question, setQuestion]   = useState('');
  const [answers, setAnswers]     = useState<QuizAnswer[]>([makeAnswer(true), makeAnswer(), makeAnswer(), makeAnswer()]);
  const [prizeCode, setPrizeCode] = useState('');
  const [channel, setChannel]     = useState('');

  const channels = allChannels.length ? allChannels : [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/quiz', { headers: { 'x-internal-user-id': activeProfileId } });
      const data = await r.json();
      setQuizzes(Array.isArray(data) ? data : []);
    } catch { setQuizzes([]); }
    setLoading(false);
  }, [activeProfileId]);

  useEffect(() => { load(); }, [load]);

  const setCorrect = (idx: number) =>
    setAnswers(prev => prev.map((a, i) => ({ ...a, correct: i === idx })));

  const setAnswerText = (idx: number, text: string) =>
    setAnswers(prev => prev.map((a, i) => i === idx ? { ...a, text } : a));

  const addAnswer = () => {
    if (answers.length >= 8) return;
    setAnswers(prev => [...prev, makeAnswer()]);
  };

  const removeAnswer = (idx: number) => {
    if (answers.length <= 2) return;
    setAnswers(prev => {
      const next = prev.filter((_, i) => i !== idx);
      // se rimosso era l'unica corretta, segna la prima
      if (!next.some(a => a.correct)) next[0].correct = true;
      return next;
    });
  };

  const resetForm = () => {
    setQuestion('');
    setAnswers([makeAnswer(true), makeAnswer(), makeAnswer(), makeAnswer()]);
    setPrizeCode('');
    setChannel(channels[0] ?? '');
    setError('');
  };

  const handleCreate = async () => {
    if (!question.trim())                        return setError('Inserisci la domanda');
    if (answers.some(a => !a.text.trim()))       return setError('Compila tutte le risposte');
    if (!answers.some(a => a.correct))           return setError('Seleziona la risposta corretta');
    if (!prizeCode.trim())                       return setError('Inserisci il codice buono Amazon');
    if (!channel)                                return setError('Seleziona il canale');

    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-user-id': activeProfileId },
        body: JSON.stringify({ question: question.trim(), answers, prizeCode: prizeCode.trim(), channelId: channel }),
      });
      const data = await r.json();
      if (!data.ok) { setError(data.error ?? 'Errore'); setSaving(false); return; }
      setShowForm(false);
      resetForm();
      await load();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleCancel = async (id: string) => {
    if (!window.confirm('Annullare questo quiz?')) return;
    await fetch(`/api/quiz?id=${id}`, { method: 'DELETE', headers: { 'x-internal-user-id': activeProfileId } });
    await load();
  };

  return (
    <div className="pg">
      <PageHeader title="Quiz & Premi" onBack={() => nav('dash')} />

      <div style={{ padding: '0 16px 16px' }}>
        {!showForm ? (
          <button className="btn bp" style={{ width: '100%', marginBottom: 16 }}
            onClick={() => { resetForm(); setShowForm(true); }}>
            + Nuovo Quiz
          </button>
        ) : (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Nuovo Quiz</div>

            <span className="lbl">Domanda</span>
            <textarea className="inp" rows={3} style={{ resize: 'none', marginBottom: 12 }}
              placeholder="es. Qual è la capitale dell'Italia?"
              value={question} onChange={e => setQuestion(e.target.value)} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span className="lbl" style={{ margin: 0 }}>Risposte — tocca il cerchio per segnare quella corretta</span>
            </div>

            {answers.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <button
                  style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0, cursor: 'pointer',
                    background: a.correct ? 'var(--a1)' : 'var(--bg4)',
                    border: a.correct ? '2px solid var(--a1)' : '2px solid var(--bd)',
                    color: a.correct ? '#fff' : 'var(--t2)',
                    fontWeight: 700, fontSize: 12,
                  }}
                  onClick={() => setCorrect(i)}>{LETTERS[i]}</button>
                <input className="inp" style={{ flex: 1, margin: 0 }}
                  placeholder={`Risposta ${LETTERS[i]}`}
                  value={a.text} onChange={e => setAnswerText(i, e.target.value)} />
                {answers.length > 2 && (
                  <button onClick={() => removeAnswer(i)}
                    style={{ background: 'none', border: 'none', color: 'var(--re)', fontSize: 18, cursor: 'pointer', flexShrink: 0, padding: '0 2px' }}>
                    ✕
                  </button>
                )}
              </div>
            ))}

            {answers.length < 8 && (
              <button className="btn" style={{ width: '100%', marginBottom: 12, fontSize: 13 }} onClick={addAnswer}>
                + Aggiungi risposta
              </button>
            )}

            <span className="lbl">Codice Buono Amazon</span>
            <input className="inp" placeholder="es. ABCD-EFGH-1234"
              value={prizeCode} onChange={e => setPrizeCode(e.target.value)} />

            <span className="lbl">Canale</span>
            <select className="inp" value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="">— Seleziona canale —</option>
              {channels.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {error && <div style={{ color: 'var(--re)', fontSize: 13, margin: '8px 0' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn bp" style={{ flex: 1 }} onClick={handleCreate} disabled={saving}>
                {saving ? '⏳ Pubblicazione…' : '🚀 Pubblica Quiz'}
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => setShowForm(false)}>
                Annulla
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--t2)', padding: 32 }}>Caricamento…</div>
        ) : quizzes.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', color: 'var(--t2)', padding: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
            <div>Nessun quiz ancora</div>
          </div>
        ) : quizzes.map(q => (
          <div key={q.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, flex: 1, marginRight: 8 }}>{q.question}</span>
              {statusBadge(q.status)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 6 }}>
              {(q.answers as QuizAnswer[]).map((a, i) => (
                <span key={i} style={{ marginRight: 10 }}>
                  <span style={{ color: a.correct ? 'var(--a1)' : 'inherit' }}>{LETTERS[i]}. {a.text}</span>
                </span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 4 }}>
              Canale: <b>{q.channel_id}</b> · {new Date(q.created_at).toLocaleDateString('it-IT')}
            </div>
            {q.status === 'won' && q.winner_username && (
              <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 4 }}>
                🏆 Vinto da <b>{q.winner_username}</b>
              </div>
            )}
            {q.status === 'active' && (
              <button className="btn bre" style={{ marginTop: 4, padding: '4px 12px', fontSize: 12 }}
                onClick={() => handleCancel(q.id)}>
                Annulla Quiz
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
