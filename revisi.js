import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateWithReference(imageABuffer, imageBBuffer, userRequest) {

    // LANGKAH 1: Analisis kedua gambar dengan GPT-4o Vision
    // GPT-4o "membaca" gambar A dan B, lalu buat prompt detail
    const analysisResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: `Kamu adalah ahli desain grafis. 
Saya punya 2 gambar:
- Gambar A (gambar utama yang mau dimodifikasi)
- Gambar B (referensi gaya/style yang mau ditiru)

Request user: "${userRequest}"

Tugasmu:
1. Analisis Gambar A secara detail (konten, layout, warna, elemen)
2. Analisis Gambar B secara detail (gaya, warna, tipografi, mood, style)
3. Buat prompt image generation yang menggabungkan:
   - Konten dari Gambar A
   - Gaya/style dari Gambar B
   
Berikan output HANYA dalam format JSON:
{
  "analysis_a": "deskripsi detail gambar A",
  "analysis_b": "deskripsi detail gaya gambar B",
  "combined_prompt": "prompt lengkap untuk generate gambar baru"
}`
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpeg;base64,${imageABuffer.toString("base64")}`,
                            detail: "high"
                        }
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:image/jpeg;base64,${imageBBuffer.toString("base64")}`,
                            detail: "high"
                        }
                    }
                ]
            }
        ],
        max_tokens: 1000
    });

    // Parse hasil analisis
    const analysisText = analysisResponse.choices[0].message.content;
    const analysis = JSON.parse(analysisText);

    console.log("Analisis A:", analysis.analysis_a);
    console.log("Analisis B:", analysis.analysis_b);
    console.log("Combined Prompt:", analysis.combined_prompt);

    // LANGKAH 2: Generate gambar baru dengan combined prompt
    // Pakai Replicate FLUX atau GPT Image API
    const imageResult = await generateImage(analysis.combined_prompt);

    return {
        analysis,
        imageUrl: imageResult
    };
}