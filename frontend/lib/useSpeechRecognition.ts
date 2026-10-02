'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// Thin wrapper around the browser's SpeechRecognition API (Web Speech API), used
// by Speak the Words / Speak the Words Set / Dictation. There is no server-side
// audio/transcription infrastructure in this codebase by design (browser-only,
// no audio storage) — grading is based on whatever the browser's built-in
// recognizer heard, which isn't perfect. Safari's support is notably weak, so
// unsupported browsers get an explicit message rather than a silent failure.

interface UseSpeechRecognitionResult {
  supported: boolean
  listening: boolean
  transcript: string
  error: string | null
  start: () => void
  stop: () => void
  reset: () => void
}

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognitionCtor) {
      setSupported(false)
      return
    }
    setSupported(true)
    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event: any) => {
      let combined = ''
      for (let i = 0; i < event.results.length; i++) {
        combined += event.results[i][0].transcript
      }
      setTranscript(combined)
    }
    recognition.onerror = (event: any) => {
      setError(event.error === 'not-allowed' ? 'Microphone access was denied.' : `Speech recognition error: ${event.error}`)
      setListening(false)
    }
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    return () => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      try { recognition.stop() } catch {}
    }
  }, [])

  const start = useCallback(() => {
    if (!recognitionRef.current) return
    setError(null)
    setTranscript('')
    try {
      recognitionRef.current.start()
      setListening(true)
    } catch {
      // start() throws if already started — ignore.
    }
  }, [])

  const stop = useCallback(() => {
    if (!recognitionRef.current) return
    try { recognitionRef.current.stop() } catch {}
    setListening(false)
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
    setError(null)
  }, [])

  return { supported, listening, transcript, error, start, stop, reset }
}
