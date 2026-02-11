import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

export const generateQuestionsForTopic = async (topic: string, categoryName: string): Promise<Question[]> => {
  if (!apiKey) {
    // Fallback mock data if no API key is present
    console.warn("API Key not found. Returning mock questions.");
    return [
      {
        questionText: `${categoryName} - ${topic} hakkında örnek soru 1: Aşağıdakilerden hangisi yanlıştır? (API Key eksik)`,
        options: ["Seçenek A", "Seçenek B", "Seçenek C", "Seçenek D", "Seçenek E"],
        correctOptionIndex: 0,
        explanation: "API anahtarı olmadığı için bu bir örnek sorudur."
      },
      {
        questionText: `${categoryName} - ${topic} hakkında örnek soru 2: Hangisi doğrudur?`,
        options: ["Seçenek A", "Seçenek B", "Seçenek C", "Seçenek D", "Seçenek E"],
        correctOptionIndex: 1,
        explanation: "API anahtarı girildiğinde gerçek sorular yüklenecektir."
      }
    ];
  }

  try {
    const prompt = `Sen uzman bir KPSS eğitmenisin. Konu: "${categoryName} - ${topic}". 
    Bu konu hakkında KPSS formatına uygun, orta-zorluk seviyesinde 5 adet çoktan seçmeli özgün soru hazırla.
    Sorular bilgi ağırlıklı ve düşündürücü olsun.
    Cevapları ve detaylı açıklamaları da ekle.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              questionText: { type: Type.STRING },
              options: { 
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "5 options (A, B, C, D, E)"
              },
              correctOptionIndex: { type: Type.INTEGER, description: "0-4 index of correct option" },
              explanation: { type: Type.STRING, description: "Detailed explanation of the answer" }
            },
            required: ["questionText", "options", "correctOptionIndex", "explanation"]
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No text returned from Gemini");

    const questions: Question[] = JSON.parse(jsonText);
    return questions;

  } catch (error) {
    console.error("Error generating questions:", error);
    throw new Error("Sorular oluşturulurken bir hata oluştu.");
  }
};