const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AIService = {
  async summarizePrompt(userPrompt, previousSummary = null) {
    try {
      const messages = [
        {
          role: 'system',
          content: 'Anda adalah seorang desainer grafis profesional kelas dunia dengan keahlian mendalam di Canva, Adobe Illustrator, dan Adobe Photoshop. Tugas Anda adalah merangkum permintaan user untuk membuat DESAIN GRAFIS MODERN yang sangat profesional — bisa berupa poster, flyer, banner, konten media sosial, infografis, atau karya visual lainnya.\n\n⚠️ ATURAN WAJIB — JANGAN PERNAH DIABAIKAN:\n- Semua detail SPESIFIK dari user (nomor HP/WA, harga, URL, nama brand, nama orang, alamat, kode promo, tanggal, atau teks literal apapun) HARUS muncul PERSIS kata per kata di "summary_id" DAN di "english_prompt".\n- Jangan pernah menghilangkan, memparafrase, atau mengubah detail spesifik tersebut.\n- Jika user menyebut nomor HP "0812-3456-7890", tulis PERSIS "0812-3456-7890" di kedua field.\n- Jika user menyebut harga "Rp 2.500.000", tulis PERSIS "Rp 2.500.000" di kedua field.\n\nBerikan output HANYA dalam format JSON dengan struktur berikut:\n{\n  "summary_id": "kesimpulan detail dalam bahasa Indonesia untuk dibaca user — WAJIB mencantumkan SEMUA detail spesifik dari user apa adanya (nomor HP, harga, nama, teks, dll.)",\n  "english_prompt": "prompt image generation SANGAT SPESIFIK dalam bahasa Inggris. WAJIB menyertakan: \\"Professional graphic design, Canva/Illustrator/Photoshop quality, modern layout, bold clean typography, vibrant color palette, well-balanced composition, premium visual aesthetic\\". Jelaskan rinci: warna dominan, tipografi, layout, elemen grafis. WAJIB TULIS PERSIS semua detail spesifik user dalam tanda kutip, contoh: with bold text \\"SALE 50%\\", contact number \\"0812-3456-7890\\", price tag \\"Rp 2.500.000\\".",\n  "image_size": "Tentukan orientasi optimal. Pilih salah satu persis: \'1024x1024\' (persegi), \'1024x1792\' (potret/vertikal), atau \'1792x1024\' (lanskap/horizontal). Jika tidak disebutkan, asumsikan \'1024x1792\'."\n}'
        }
      ];

      if (previousSummary) {
        messages.push({ role: 'user', content: `Ini kesimpulan sebelumnya:\n${previousSummary}\n\nRevisi kesimpulan tersebut berdasarkan instruksi berikut: ${userPrompt}` });
      } else {
        messages.push({ role: 'user', content: userPrompt });
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: messages,
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Summarize error:', error);
      return null;
    }
  },

  async analyzeMultipleImagesAndSummarize(existingSummary, imagesBase64Array, userNotes) {
    try {
      const hasImages = imagesBase64Array && imagesBase64Array.length > 0;
      
      const content = [
        {
          type: 'text',
          text: `Ini adalah kesimpulan desain saat ini (mungkin berupa JSON atau teks biasa):\n\n${typeof existingSummary === 'string' ? existingSummary : JSON.stringify(existingSummary)}\n\n${hasImages ? 'Dan berikut adalah kumpulan gambar referensi dari user.' : ''}\nTambahan catatan referensi dari user: "${userNotes}"\n\nTolong analisis referensi ini dan buatkan kesimpulan desain yang baru (format JSON).`
        }
      ];

      if (hasImages) {
        for (const imgBase64 of imagesBase64Array) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imgBase64}`
            }
          });
        }
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Anda adalah desainer grafis profesional kelas dunia dengan keahlian expert di Canva, Adobe Illustrator, dan Adobe Photoshop. Tugas Anda adalah memperbarui kesimpulan desain dengan mengadaptasi gaya, layout, tipografi, palet warna, elemen grafis, dan komposisi dari gambar referensi user agar hasil akhirnya setara dengan karya agensi desain kreatif terkemuka.\n\nBerikan output HANYA dalam format JSON dengan struktur berikut:\n{\n  "summary_id": "kesimpulan detail dalam bahasa Indonesia untuk dibaca user (fokuskan pada: gaya visual referensi, palet warna, tipografi, komposisi layout, elemen dekoratif, dan nuansa desain yang diadopsi)",\n  "english_prompt": "prompt bahasa Inggris lengkap dan sangat detail. HARUS menyertakan: gaya desain (modern/minimalist/bold/elegant/etc.), palet warna spesifik, jenis tipografi, komposisi layout, elemen grafis dekoratif, tekstur, dan suasana visual keseluruhan — setara kualitas Canva Pro / Illustrator / Photoshop professional. PENTING: Jika user meminta tulisan/teks spesifik, WAJIB tuliskan persis di dalam tanda kutip.",\n  "image_size": "Tentukan orientasi optimal berdasarkan referensi/catatan user. Pilih salah satu: \'1024x1024\' (persegi), \'1024x1792\' (potret), atau \'1792x1024\' (lanskap). Jika tidak disebutkan, gunakan \'1024x1792\'."\n}'
          },
          {
            role: 'user',
            content: content
          }
        ],
        max_tokens: 1500
      });
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      console.error('Image analysis error:', error);
      return null;
    }
  },
  
  // Method to analyze revision with Gambar A (last generated) and multiple optional references
  async analyzeRevision(lastImageUrl, newReferencesBase64Array, userRequest) {
    try {
      // Pastikan lastImageUrl dikirim dalam format base64 ke OpenAI untuk menghindari error format
      let imageABase64 = lastImageUrl;
      if (lastImageUrl && lastImageUrl.startsWith('http')) {
        const fetch = require('node-fetch');
        const response = await fetch(lastImageUrl);
        const buffer = await response.arrayBuffer();
        imageABase64 = Buffer.from(buffer).toString('base64');
      }

      const hasNewReferences = newReferencesBase64Array && newReferencesBase64Array.length > 0;

      const content = [
        {
          type: "text",
          text: `You are a world-class professional graphic designer with expert-level proficiency in Canva, Adobe Illustrator, and Adobe Photoshop. You specialize in modern design for all categories: posters, social media content, branding, flyers, banners, infographics, and more.
I have ${hasNewReferences ? (1 + newReferencesBase64Array.length) + ' images' : '1 image'}:
- Image A (the main design to be modified/revised)
${hasNewReferences ? '- Reference Image(s) (style, layout, typography, color palette to replicate)\n' : ''}
User notes: "${userRequest}"

Your tasks:
1. Analyze Image A in detail (assess composition, color palette, typography, visual hierarchy, and design strengths/weaknesses)
${hasNewReferences ? '2. Analyze all Reference Images collectively (design style, layout structure, typography, color palette, decorative elements, overall aesthetic)\n3. Generate an image generation prompt that combines the content from Image A, the visual style from references, and the user notes' : '2. Generate a new image generation prompt that improves Image A based on user notes, elevating it to professional graphic design quality.'}
   
Respond ONLY in JSON format:
{
  "analysis_a": "detailed description of Image A",
  ${hasNewReferences ? '"analysis_b": "detailed description of reference design style and elements",' : ''}
  "combined_prompt": "Full prompt in English. MUST emphasize: 'Professional graphic design, Canva/Illustrator/Photoshop quality, modern layout, bold clean typography, vibrant well-balanced composition, premium visual aesthetic'. Include specific colors, fonts style, layout zones, decorative elements. IMPORTANT: If user requested specific text, include it exactly in quotes.",
  "image_size": "Choose the appropriate aspect ratio: '1024x1024' (square), '1024x1792' (portrait), or '1792x1024' (landscape)."
}`
        }
      ];

      // Add Gambar A
      if (imageABase64) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${imageABase64}`
          }
        });
      }

      // Add all new references
      if (hasNewReferences) {
        for (const refB64 of newReferencesBase64Array) {
          content.push({
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${refB64}`
            }
          });
        }
      }

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: content
          }
        ],
        max_tokens: 1500
      });

      const analysisText = response.choices[0].message.content;
      return JSON.parse(analysisText);
    } catch (error) {
      console.error('Revision analysis error:', error);
      return null;
    }
  }
};

module.exports = AIService;
