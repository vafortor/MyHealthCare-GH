
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Message, TriageResult, TriageLevel, Provider, AssessmentData, Subscription } from './types';
import { processTriage, processSupport, searchProviders, getGreeting, generateSpeech } from './services/geminiService';
import { RED_FLAGS, APP_THEME } from './constants';

type ChatMode = 'triage' | 'support';

const LANGUAGES = [
  { code: 'English', label: 'English', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Akan', label: 'Akan', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Ga', label: 'Ga', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Ewe', label: 'Ewe', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Nzema', label: 'Nzema', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Dagbani', label: 'Dagbani', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Dagaare', label: 'Dagaare', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Kasem', label: 'Kasem', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Gonja', label: 'Gonja', flag: '🇬🇭', voice: 'Kore' },
  { code: 'Francais', label: 'Francais', flag: '🇫🇷', voice: 'Kore' }
];

const MOMO_NUMBER = "+233248279518";
const PREMIUM_PRICE = 25;
const DONATION_PRESETS = [100, 200, 400];

// Helper functions for audio processing
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [language, setLanguage] = useState('English');
  const [langSearch, setLangSearch] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [savedProviders, setSavedProviders] = useState<Provider[]>([]);
  const [zipCode, setZipCode] = useState('');
  const [insurance, setInsurance] = useState('');
  const [showConsent, setShowConsent] = useState(true);
  const [isEmergencyEscalated, setIsEmergencyEscalated] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showSubscriptionForm, setShowSubscriptionForm] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mode, setMode] = useState<ChatMode>('triage');
  
  // Subscription States
  const [subForm, setSubForm] = useState<Subscription>({ fullName: '', email: '', momoNumber: '' });
  const [selectedAmount, setSelectedAmount] = useState<number | 'other'>(PREMIUM_PRICE);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('navicare_saved_providers');
    if (saved) {
      try {
        setSavedProviders(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load saved providers", e);
      }
    }

    const sub = localStorage.getItem('navicare_subscription');
    if (sub) {
      setIsSubscribed(true);
      try {
        setSubForm(JSON.parse(sub));
      } catch(e) {}
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setShowLangMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    // Initialize Speech Recognition if available
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredLanguages = useMemo(() => {
    return LANGUAGES.filter(l => 
      l.label.toLowerCase().includes(langSearch.toLowerCase()) || 
      l.code.toLowerCase().includes(langSearch.toLowerCase())
    );
  }, [langSearch]);

  const saveToLocalStorage = (data: Provider[]) => {
    localStorage.setItem('navicare_saved_providers', JSON.stringify(data));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleStart = async () => {
    setShowConsent(false);
    setLoading(true);
    try {
      const greeting = await getGreeting(language);
      const initialMessage: Message = {
        role: 'model',
        text: greeting,
        timestamp: Date.now()
      };
      setMessages([initialMessage]);
    } catch (error) {
      setMessages([{
        role: 'model',
        text: "Hello, I am MyHealthCare-GH. How can I help you today?",
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleNewAssessment = () => {
    setMessages([]);
    setInput('');
    setLoading(false);
    setTriageResult(null);
    setProviders([]);
    setZipCode('');
    setInsurance('');
    setIsEmergencyEscalated(false);
    setShowSaved(false);
    setShowConsent(true);
    setIsSpeaking(false);
    setIsListening(false);
    setShowSubscriptionForm(false);
    setMode('triage');
    
    if (recognitionRef.current) recognitionRef.current.stop();
    if (audioContextRef.current) {
      audioContextRef.current.close().then(() => {
        audioContextRef.current = null;
      });
    }
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subForm.fullName || !subForm.email || !subForm.momoNumber) return;
    
    setIsSubscribing(true);
    // Simulate payment trigger / API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsSubscribed(true);
    setIsSubscribing(false);
    localStorage.setItem('navicare_subscription', JSON.stringify(subForm));
    setShowSubscriptionForm(false);
  };

  const playVoice = async (text: string) => {
    if (isSpeaking) return;
    setIsSpeaking(true);
    try {
      const voiceData = await generateSpeech(text);
      if (voiceData) {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        const outputNode = ctx.createGain();
        outputNode.connect(ctx.destination);
        
        const audioBuffer = await decodeAudioData(
          decode(voiceData),
          ctx,
          24000,
          1
        );
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputNode);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else {
        setIsSpeaking(false);
      }
    } catch (e) {
      console.error("Speech synthesis failed", e);
      setIsSpeaking(false);
    }
  };

  const handleListen = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.lang = LANGUAGES.find(l => l.code === language)?.code || 'en-US';
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      text: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, userMessage].map(m => ({
        role: m.role,
        text: m.text
      }));

      if (mode === 'triage') {
        const result = await processTriage(history, language);

        if (result.isTriageComplete && result.triageResult) {
          setTriageResult(result.triageResult);
          if (result.triageResult.level === TriageLevel.EMERGENCY) {
            setIsEmergencyEscalated(true);
          }
          
          const assistantMessage: Message = {
            role: 'model',
            text: result.triageResult.recommendation,
            timestamp: Date.now()
          };
          setMessages(prev => [...prev, assistantMessage]);
        } else {
          const assistantMessage: Message = {
            role: 'model',
            text: result.nextQuestion || "Can you tell me more?",
            timestamp: Date.now()
          };
          setMessages(prev => [...prev, assistantMessage]);
        }
      } else {
        // Support mode
        const supportResponse = await processSupport(history, language);
        const assistantMessage: Message = {
          role: 'model',
          text: supportResponse,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, {
        role: 'model',
        text: "I'm having a technical issue. Please try again or seek medical advice if your symptoms are concerning.",
        timestamp: Date.now()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleProviderSearch = async () => {
    if (!zipCode || !triageResult?.specialtyNeeded) return;
    setLoading(true);
    try {
      const found = await searchProviders(triageResult.specialtyNeeded, zipCode, insurance, language);
      setProviders(found);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSaveProvider = (provider: Provider) => {
    const isSaved = savedProviders.find(p => p.name === provider.name && p.phone === provider.phone);
    let newSaved;
    if (isSaved) {
      newSaved = savedProviders.filter(p => p.name !== provider.name || p.phone !== provider.phone);
    } else {
      newSaved = [...savedProviders, provider];
    }
    setSavedProviders(newSaved);
    saveToLocalStorage(newSaved);
  };

  const isProviderSaved = (provider: Provider) => {
    return savedProviders.some(p => p.name === provider.name && p.phone === provider.phone);
  };

  if (showConsent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-100">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-600 p-4 rounded-full relative">
              <i className="fa-solid fa-house-medical text-3xl text-white"></i>
              <span className="absolute -bottom-1 -right-1 text-xl">🇬🇭</span>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center mb-2 text-slate-800 flex items-center justify-center gap-2">
            Welcome to MyHealthCare-GH
          </h1>
          
          <div className="mb-6">
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-2">Select Preferred Language</label>
            <div className="relative mb-3">
              <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input 
                type="text"
                placeholder="Search language..."
                value={langSearch}
                onChange={(e) => setLangSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition"
              />
            </div>
            <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-lg p-1 bg-slate-50 scrollbar-thin scrollbar-thumb-slate-200">
              <div className="grid grid-cols-1 gap-1">
                {filteredLanguages.map(lang => (
                  <button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md transition text-sm ${
                      language === lang.code 
                      ? 'bg-blue-600 text-white font-bold' 
                      : 'hover:bg-white text-slate-600 border border-transparent hover:border-slate-200'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-base">{lang.flag}</span>
                      <span>{lang.label}</span>
                    </span>
                    {language === lang.code && <i className="fa-solid fa-check text-[10px]"></i>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-slate-600 mb-6 text-center text-sm leading-relaxed border-t pt-4">
            MyHealthCare-GH helps you assess symptoms and navigate to the right medical setting. 
            We are dedicated to improving healthcare accessibility across Ghana.
          </p>
          
          <button 
            onClick={handleStart}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg transition shadow-lg active:scale-95"
          >
            I Understand & Start
          </button>
        </div>
      </div>
    );
  }

  const renderProviderCard = (p: Provider, idx: number) => (
    <div key={idx} className="group border border-slate-100 rounded-xl p-4 bg-white hover:border-blue-200 hover:shadow-md transition">
      <div className="flex justify-between items-start mb-2">
        <h5 className="font-bold text-slate-800 text-sm">{p.name}</h5>
        <button 
          onClick={() => toggleSaveProvider(p)}
          className={`p-1 rounded-full transition ${isProviderSaved(p) ? 'text-amber-500 bg-amber-50' : 'text-slate-300 hover:text-amber-500 bg-slate-50'}`}
        >
          <i className={`fa-${isProviderSaved(p) ? 'solid' : 'regular'} fa-star`}></i>
        </button>
      </div>
      
      <p className="text-[11px] text-slate-500 mb-2 flex items-start gap-1">
        <i className="fa-solid fa-location-dot mt-0.5 text-slate-400"></i>
        {p.address}
      </p>
      
      <div className="flex flex-col gap-2 pt-2 border-t border-slate-50">
        <div className="flex items-center justify-between">
           <a href={`tel:${p.phone}`} className="text-[11px] text-blue-600 font-bold flex items-center gap-1 hover:underline">
             <i className="fa-solid fa-phone"></i> {p.phone}
           </a>
           {p.verified && (
             <span className="text-[9px] flex items-center gap-0.5 text-emerald-600 font-bold">
               <i className="fa-solid fa-circle-check"></i> VERIFIED
             </span>
           )}
        </div>
        
        {p.bookingUrl && (
          <a 
            href={p.bookingUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="w-full bg-blue-50 text-blue-700 text-center py-2 rounded-lg text-xs font-bold hover:bg-blue-100 transition mt-1"
          >
            Book Appointment
          </a>
        )}
      </div>
    </div>
  );

  const totalAmount = selectedAmount === 'other' ? (customAmount || '0') : selectedAmount;

  return (
    <div className="flex flex-col h-screen max-w-6xl mx-auto bg-white shadow-2xl relative">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-lg relative">
            <i className="fa-solid fa-route text-white"></i>
          </div>
          <div>
            <h1 className="font-bold text-slate-800 leading-tight flex items-center gap-2">
              MyHealthCare-GH
            </h1>
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
              {language} Assessment
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
            <div className="relative" ref={langMenuRef}>
              <button 
                onClick={() => {
                  setShowLangMenu(!showLangMenu);
                  setLangSearch('');
                }}
                className={`p-2 rounded-lg transition flex items-center gap-1 ${showLangMenu ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                title="Change Language"
              >
                <i className="fa-solid fa-globe"></i>
                <span className="text-[10px] font-bold">{LANGUAGES.find(l => l.code === language)?.flag}</span>
              </button>
              {showLangMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-2xl z-20 py-3 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="px-3 pb-2 border-b border-slate-50 mb-2">
                    <div className="relative">
                      <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                      <input 
                        type="text"
                        autoFocus
                        placeholder="Search..."
                        value={langSearch}
                        onChange={(e) => setLangSearch(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:ring-1 focus:ring-blue-400 outline-none"
                      />
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-slate-100">
                    {filteredLanguages.map(lang => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setLanguage(lang.code);
                          setShowLangMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between rounded-lg transition ${language === lang.code ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-600 hover:bg-slate-50'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span>{lang.flag}</span>
                          <span>{lang.label}</span>
                        </span>
                        {language === lang.code && <i className="fa-solid fa-check scale-75"></i>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button 
              onClick={() => setShowSaved(!showSaved)}
              className={`p-2 rounded-lg transition ${showSaved ? 'bg-amber-100 text-amber-600' : 'text-slate-400 hover:text-slate-600'}`}
              title="Saved Providers"
            >
              <i className="fa-solid fa-star"></i>
              {savedProviders.length > 0 && <span className="ml-1 text-xs font-bold">{savedProviders.length}</span>}
            </button>
            <button 
              onClick={handleNewAssessment}
              className="text-slate-400 hover:text-slate-600 p-2 transition"
              title="New Assessment"
            >
              <i className="fa-solid fa-rotate-right"></i>
            </button>
        </div>
      </header>

      {/* Main Content Area - Proportional Adjustments for Larger Chat */}
      <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 flex flex-col md:flex-row gap-6">
        {/* Left Column: Chat Interface - flex-2 for more width */}
        <div className="flex-[2] flex flex-col h-full bg-slate-50 rounded-xl border border-slate-200 overflow-hidden min-h-[500px] shadow-sm">
          {/* Mode Switcher */}
          <div className="flex border-b border-slate-200 bg-white">
            <button 
              onClick={() => setMode('triage')}
              className={`flex-1 py-3.5 text-xs font-bold uppercase tracking-wider transition-all ${mode === 'triage' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <i className="fa-solid fa-stethoscope mr-2"></i>
              Symptom Triage
            </button>
            <button 
              onClick={() => setMode('support')}
              className={`flex-1 py-3.5 text-xs font-bold uppercase tracking-wider transition-all ${mode === 'support' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <i className="fa-solid fa-headset mr-2"></i>
              App Support
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 italic text-center p-8 max-w-md mx-auto">
                <i className={`fa-solid ${mode === 'triage' ? 'fa-heart-pulse' : 'fa-circle-question'} text-5xl mb-6 opacity-10`}></i>
                <p className="text-sm leading-relaxed font-medium">
                  {mode === 'triage' 
                    ? "Start by describing your symptoms in detail. I'll ask a few targeted questions to help navigate you to the right care setting." 
                    : "Ask me anything about MyHealthCare-GH platform, contribution options, or how to get support."}
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-4 md:p-5 rounded-2xl relative shadow-sm border ${
                  m.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none border-blue-700' 
                  : 'bg-white border-slate-200 text-slate-800 rounded-tl-none'
                }`}>
                  <p className="text-sm md:text-base whitespace-pre-wrap leading-relaxed font-medium">{m.text}</p>
                  
                  {m.role === 'model' && (
                    <button 
                      onClick={() => playVoice(m.text)}
                      disabled={isSpeaking}
                      className={`absolute -right-8 bottom-2 text-slate-400 hover:text-blue-500 transition-colors ${isSpeaking ? 'animate-pulse text-blue-500' : ''}`}
                      title="Read aloud"
                    >
                      <i className={`fa-solid ${isSpeaking ? 'fa-volume-high' : 'fa-volume-low'}`}></i>
                    </button>
                  )}

                  <span className={`text-[10px] mt-2 block opacity-70 ${m.role === 'user' ? 'text-blue-100 text-right' : 'text-slate-400'}`}>
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none shadow-sm flex gap-1.5 items-center">
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-.5s]"></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input - Comfortable and Spacious */}
          <div className="p-4 md:p-6 bg-white border-t border-slate-200">
              <div className="flex gap-3 items-center max-w-4xl mx-auto">
                <button 
                  onClick={handleListen}
                  className={`w-11 h-11 flex items-center justify-center rounded-full transition-all ${isListening ? 'bg-red-500 text-white animate-pulse shadow-lg' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                  title={isListening ? "Stop listening" : "Voice input"}
                >
                  <i className={`fa-solid ${isListening ? 'fa-microphone-slash' : 'fa-microphone'} text-lg`}></i>
                </button>
                
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={isListening ? "Listening..." : mode === 'triage' ? "Describe your symptoms (e.g. 'I have a headache and fatigue')..." : "Ask a platform question..."}
                  className={`flex-1 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm md:text-base focus:ring-4 focus:ring-blue-50 focus:border-blue-500 focus:outline-none transition-all`}
                />
                
                <button 
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className={`w-11 h-11 flex items-center justify-center rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 ${mode === 'triage' ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                >
                  <i className="fa-solid fa-paper-plane"></i>
                </button>
              </div>
          </div>
        </div>

        {/* Right Column: Results & Providers - flex-1 for secondary focal point */}
        <aside className={`flex-1 md:max-w-sm flex flex-col gap-4 overflow-y-auto`}>
           {/* Saved Providers Overlay View */}
           {showSaved && (
             <div className="bg-amber-50 rounded-xl border border-amber-200 shadow-sm p-4 mb-2 animate-in fade-in duration-200">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-amber-800 flex items-center gap-2">
                    <i className="fa-solid fa-star"></i>
                    Saved Providers
                  </h3>
                  <button onClick={() => setShowSaved(false)} className="text-amber-800 hover:bg-amber-100 w-8 h-8 rounded-lg flex items-center justify-center transition">
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                  {savedProviders.length === 0 ? (
                    <p className="text-center text-amber-600 text-xs py-12 italic">No providers saved yet.</p>
                  ) : (
                    savedProviders.map((p, idx) => renderProviderCard(p, idx))
                  )}
                </div>
             </div>
           )}

           {/* Triage Status Card */}
           {triageResult && !showSaved && (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-right-4">
                <div className={`p-4 flex items-center gap-3 text-white ${
                  triageResult.level === TriageLevel.EMERGENCY ? 'bg-red-600' :
                  triageResult.level === TriageLevel.URGENT ? 'bg-amber-500' :
                  triageResult.level === TriageLevel.ROUTINE ? 'bg-blue-600' : 'bg-emerald-500'
                }`}>
                  <i className={`fa-solid ${
                    triageResult.level === TriageLevel.EMERGENCY ? 'fa-triangle-exclamation' :
                    triageResult.level === TriageLevel.URGENT ? 'fa-clock' :
                    triageResult.level === TriageLevel.ROUTINE ? 'fa-calendar-check' : 'fa-house'
                  }`}></i>
                  <h2 className="font-bold uppercase tracking-wider text-xs">Triage: {triageResult.level}</h2>
                </div>
                <div className="p-4">
                  <div className="mb-4">
                    <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Recommended Specialty</label>
                    <p className="font-bold text-slate-800">{triageResult.specialtyNeeded || 'General Practice'}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                     <label className="text-[10px] uppercase font-bold text-slate-400 block mb-2 tracking-wider">Referral Summary</label>
                     <p className="text-xs text-slate-700 italic leading-relaxed">"{triageResult.summary}"</p>
                     <button 
                       onClick={() => navigator.clipboard.writeText(triageResult.summary)}
                       className="mt-3 w-full bg-white border border-slate-200 text-blue-600 py-2 rounded-lg text-xs font-bold hover:bg-blue-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                     >
                       <i className="fa-regular fa-copy"></i> Copy to clipboard
                     </button>
                  </div>
                </div>
             </div>
           )}

           {/* Value-Based Subscription/Donation Invitation */}
           {triageResult && !isSubscribed && !showSaved && (
             <div className="bg-gradient-to-br from-blue-600 to-indigo-800 rounded-xl p-5 text-white shadow-xl animate-in zoom-in-95 duration-500 relative overflow-hidden group">
                <i className="fa-solid fa-gem absolute -right-2 -bottom-2 text-6xl opacity-10 rotate-12 transition-transform group-hover:scale-110"></i>
                <div className="flex items-center gap-2 mb-3">
                  <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm border border-white/20">
                    <i className="fa-solid fa-crown text-amber-300 text-lg animate-pulse"></i>
                  </div>
                  <h3 className="font-bold text-sm uppercase tracking-wider">Support Our Mission 🇬🇭</h3>
                </div>
                
                <p className="text-xs opacity-90 mb-4 leading-relaxed">
                  We are a community-focused mission. Help keep this platform free for all Ghanaians by choosing a support level.
                </p>

                {!showSubscriptionForm ? (
                  <button 
                    onClick={() => setShowSubscriptionForm(true)}
                    className="relative z-10 block w-full bg-white text-blue-700 text-center py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-blue-50 transition-all shadow-lg active:scale-95"
                  >
                    Subscribe or Donate
                  </button>
                ) : (
                  <form onSubmit={handleSubscribe} className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 relative z-10">
                    {/* Amount Selection Area */}
                    <div className="space-y-2">
                       <label className="text-[10px] uppercase font-bold text-white/70 block ml-1">Choose Amount (Ghc)</label>
                       <div className="grid grid-cols-4 gap-2">
                          <button 
                            type="button" 
                            onClick={() => setSelectedAmount(PREMIUM_PRICE)}
                            className={`py-2 rounded-lg text-[10px] font-bold border transition ${selectedAmount === PREMIUM_PRICE ? 'bg-amber-400 text-slate-900 border-amber-400' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}
                          >
                            25
                          </button>
                          {DONATION_PRESETS.map(amt => (
                            <button 
                              key={amt}
                              type="button" 
                              onClick={() => setSelectedAmount(amt)}
                              className={`py-2 rounded-lg text-[10px] font-bold border transition ${selectedAmount === amt ? 'bg-amber-400 text-slate-900 border-amber-400' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}
                            >
                              {amt}
                            </button>
                          ))}
                       </div>
                       <button 
                         type="button"
                         onClick={() => setSelectedAmount('other')}
                         className={`w-full py-2 rounded-lg text-[10px] font-bold border transition ${selectedAmount === 'other' ? 'bg-amber-400 text-slate-900 border-amber-400' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}
                       >
                         Other Amount
                       </button>

                       {selectedAmount === 'other' && (
                         <div className="relative animate-in slide-in-from-top-1">
                            <i className="fa-solid fa-money-bill-wave absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                            <input 
                              required
                              type="number"
                              placeholder="Enter amount in Ghc"
                              value={customAmount}
                              onChange={(e) => setCustomAmount(e.target.value)}
                              className="w-full bg-white text-slate-800 border-none rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-2 focus:ring-blue-400 outline-none"
                            />
                         </div>
                       )}
                    </div>

                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <div className="relative">
                        <i className="fa-solid fa-user absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                        <input 
                          required
                          type="text" 
                          placeholder="Full Name" 
                          value={subForm.fullName}
                          onChange={(e) => setSubForm({...subForm, fullName: e.target.value})}
                          className="w-full bg-white text-slate-800 border-none rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-2 focus:ring-blue-400 outline-none"
                        />
                      </div>
                      <div className="relative">
                        <i className="fa-solid fa-envelope absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                        <input 
                          required
                          type="email" 
                          placeholder="Email Address" 
                          value={subForm.email}
                          onChange={(e) => setSubForm({...subForm, email: e.target.value})}
                          className="w-full bg-white text-slate-800 border-none rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-2 focus:ring-blue-400 outline-none"
                        />
                      </div>
                      <div className="relative">
                        <i className="fa-solid fa-mobile-screen absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]"></i>
                        <input 
                          required
                          type="tel" 
                          placeholder="MoMo Number" 
                          value={subForm.momoNumber}
                          onChange={(e) => setSubForm({...subForm, momoNumber: e.target.value})}
                          className="w-full bg-white text-slate-800 border-none rounded-lg pl-9 pr-3 py-2 text-xs focus:ring-2 focus:ring-blue-400 outline-none"
                        />
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={isSubscribing || (selectedAmount === 'other' && !customAmount)}
                      className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 rounded-lg text-xs transition shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isSubscribing ? <i className="fa-solid fa-circle-notch animate-spin"></i> : <i className="fa-solid fa-bolt"></i>}
                      {isSubscribing ? 'Processing...' : `Pay Ghc${totalAmount} via MoMo`}
                    </button>
                    <button 
                      type="button"
                      onClick={() => setShowSubscriptionForm(false)}
                      className="w-full text-[10px] text-white/70 hover:text-white underline font-bold"
                    >
                      Maybe Later
                    </button>
                  </form>
                )}
             </div>
           )}

           {isSubscribed && triageResult && (
             <div className="bg-emerald-50 border-2 border-emerald-100 rounded-xl p-4 animate-in fade-in duration-500 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="bg-emerald-500 p-2 rounded-lg text-white">
                      <i className="fa-solid fa-star"></i>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-emerald-800">Supportive Member</h4>
                    <p className="text-[10px] text-emerald-600 font-medium">Thank you, {subForm.fullName.split(' ')[0]}, for your contribution!</p>
                  </div>
                </div>
             </div>
           )}

           {/* Provider Search Card */}
           {triageResult && triageResult.level !== TriageLevel.EMERGENCY && triageResult.level !== TriageLevel.SELF_CARE && !showSaved && (
             <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2 uppercase tracking-wider text-xs">
                  <i className="fa-solid fa-magnifying-glass-location text-blue-600"></i>
                  Find Local Care
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <input 
                      type="text" 
                      placeholder="Area or Zip Code (e.g. Kumasi, Accra)" 
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      className="w-full border-2 border-slate-50 rounded-lg px-3 py-2.5 text-sm focus:ring-0 focus:border-blue-500 outline-none transition-all"
                    />
                    <input 
                      type="text" 
                      placeholder="Insurance Provider (Optional)" 
                      value={insurance}
                      onChange={(e) => setInsurance(e.target.value)}
                      className="w-full border-2 border-slate-50 rounded-lg px-3 py-2.5 text-sm focus:ring-0 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>
                  <button 
                    onClick={handleProviderSearch}
                    disabled={loading || !zipCode}
                    className="w-full bg-slate-900 hover:bg-black text-white text-xs font-bold py-3 rounded-lg transition shadow-md disabled:opacity-50 uppercase tracking-widest"
                  >
                    Search {triageResult.specialtyNeeded || 'Providers'}
                  </button>
                </div>

                {providers.length > 0 && (
                  <div className="mt-8 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Verified Near You</h4>
                      <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold">{providers.length} Results</span>
                    </div>
                    {providers.map((p, idx) => renderProviderCard(p, idx))}
                  </div>
                )}
             </div>
           )}

           {/* Emergency Notice */}
           {isEmergencyEscalated && (
             <div className="bg-red-50 border-4 border-red-600 rounded-xl p-6 text-red-900 animate-pulse shadow-2xl">
                <div className="flex items-center gap-4 mb-4">
                  <i className="fa-solid fa-circle-exclamation text-3xl text-red-600"></i>
                  <h3 className="font-black uppercase text-lg">IMMEDIATE ACTION</h3>
                </div>
                <p className="text-sm font-bold mb-5 leading-relaxed">Your symptoms require immediate medical intervention. Do not wait.</p>
                <div className="space-y-3">
                  <a href="tel:112" className="block w-full text-center bg-red-600 text-white py-4 rounded-xl font-black text-xl shadow-lg hover:bg-red-700 transition active:scale-95">CALL 112 NOW</a>
                  <p className="text-xs text-center text-red-700 font-bold uppercase tracking-widest mt-2">Alternative: Call 999</p>
                </div>
             </div>
           )}
           
           {!triageResult && !showSaved && mode === 'triage' && (
             <div className="bg-slate-50 rounded-xl border border-slate-200 border-dashed p-16 flex flex-col items-center justify-center text-slate-400 text-center shadow-inner">
                <i className="fa-solid fa-clipboard-list text-4xl mb-4 opacity-10"></i>
                <p className="text-xs font-bold italic leading-relaxed max-w-[180px]">Your matched healthcare providers and triage summary will appear here.</p>
             </div>
           )}

           {mode === 'support' && !showSaved && (
             <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-8 flex flex-col items-center justify-center text-indigo-400 text-center shadow-inner">
                <i className="fa-solid fa-headset text-4xl mb-6 opacity-10"></i>
                <h4 className="font-bold text-indigo-700 text-xs mb-3 uppercase tracking-widest">How can we help?</h4>
                <p className="text-[10px] italic leading-relaxed font-medium">Ask questions about data privacy, how to support us, or platform features.</p>
             </div>
           )}
        </aside>
      </main>

      {/* Persistent Safety Banner */}
      <footer className="bg-slate-900 text-slate-400 py-3 px-6 text-[10px] flex justify-between items-center shrink-0 border-t border-slate-800">
         <div className="flex gap-6 font-medium uppercase tracking-widest opacity-60">
           <span>&copy; MyHealthCare-GH 2026</span>
           <span>Created by Ghit Solutions 2025</span>
           <span className="hidden sm:inline">Standard Health Compliance</span>
         </div>
         <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5">
           <i className="fa-solid fa-shield-halved text-emerald-500"></i>
           <span className="font-bold uppercase tracking-widest">Secure & Confidential</span>
         </div>
      </footer>
    </div>
  );
};

export default App;
