
import { GoogleGenAI, Type, GenerateContentResponse, Modality } from "@google/genai";
import { TriageResult, TriageLevel, Provider } from "../types";
import { SYSTEM_PROMPT, CUSTOMER_SERVICE_PROMPT } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function processTriage(history: { role: string, text: string }[], language: string) {
  const model = 'gemini-3-flash-preview';
  
  const response = await ai.models.generateContent({
    model,
    contents: history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    config: {
      systemInstruction: `${SYSTEM_PROMPT}\n\nIMPORTANT: You must communicate and provide all output (questions, recommendations, summaries) in ${language}.`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isTriageComplete: { type: Type.BOOLEAN },
          nextQuestion: { type: Type.STRING },
          triageResult: {
            type: Type.OBJECT,
            properties: {
              level: { type: Type.STRING, description: "EMERGENCY, URGENT, ROUTINE, or SELF_CARE" },
              recommendation: { type: Type.STRING },
              specialtyNeeded: { type: Type.STRING },
              reasonForReferral: { type: Type.STRING },
              summary: { type: Type.STRING }
            }
          }
        },
        required: ["isTriageComplete"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse triage response", e);
    return { isTriageComplete: false, nextQuestion: "I'm sorry, I'm having trouble processing that. Can you tell me more about your symptoms?" };
  }
}

export async function processSupport(history: { role: string, text: string }[], language: string) {
  const model = 'gemini-3-flash-preview';
  
  const response = await ai.models.generateContent({
    model,
    contents: history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    config: {
      systemInstruction: `${CUSTOMER_SERVICE_PROMPT}\n\nIMPORTANT: Respond in ${language}.`,
    }
  });

  return response.text || "I'm sorry, I couldn't process that request.";
}

export async function searchProviders(specialty: string, zipCode: string, insurance?: string, language: string = 'English'): Promise<Provider[]> {
  const model = 'gemini-3-flash-preview';
  const insuranceQuery = insurance ? ` that accept ${insurance} insurance` : "";
  const prompt = `Find 5 ${specialty} medical providers near ZIP code ${zipCode}${insuranceQuery}. 
  Provide their name, practice address, phone number, website, hours of operation, and an online booking link if available. 
  Check multiple sources to verify accuracy. 
  IMPORTANT: Provide the details and any descriptive text in ${language}.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    }
  });

  const extractionResponse = await ai.models.generateContent({
    model,
    contents: `Extract the provider details from the following text into a structured JSON list. 
    Ensure bookingUrl is a valid URL or null. 
    Include 'acceptedInsurance' as an array of strings based on the text. 
    Text: ${response.text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            specialty: { type: Type.STRING },
            address: { type: Type.STRING },
            phone: { type: Type.STRING },
            website: { type: Type.STRING },
            bookingUrl: { type: Type.STRING },
            hours: { type: Type.STRING },
            acceptedInsurance: { type: Type.ARRAY, items: { type: Type.STRING } },
            verified: { type: Type.BOOLEAN }
          },
          required: ["name", "address", "phone"]
        }
      }
    }
  });

  try {
    const providers = JSON.parse(extractionResponse.text);
    return providers.map((p: any) => ({ 
      ...p, 
      verified: p.verified ?? true,
      acceptedInsurance: p.acceptedInsurance || []
    }));
  } catch (e) {
    console.error("Failed to extract providers", e);
    return [];
  }
}

export async function getGreeting(language: string): Promise<string> {
  const model = 'gemini-3-flash-preview';
  const prompt = `Generate a warm, professional medical assistant greeting in ${language}. 
  Mention that you are MyHealthCare-GH, an assistant for symptom assessment and provider navigation. 
  Include a clear disclaimer that you are not a doctor and users should call emergency services for immediate life-threatening issues.
  End with a question asking how you can help today.`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  
  return response.text || "Hello, how can I help you today?";
}

export async function generateSpeech(text: string, voiceName: string = 'Kore'): Promise<string | undefined> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
}
