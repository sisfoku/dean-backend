const OpenAI = require('openai');
const { toFile } = require('openai');
const { Readable } = require('stream');

// Menggunakan OPENAI_IMAGE_KEY sesuai instruksi
const openai = new OpenAI({ apiKey: process.env.OPENAI_IMAGE_KEY });

/**
 * Helper: Konversi base64 string menjadi ReadStream yang bisa dikirim ke API OpenAI.
 * Digunakan karena data gambar dari Telegram sudah berupa base64.
 */
function base64ToReadable(base64String) {
  const buffer = Buffer.from(base64String, 'base64');
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

/**
 * Helper: Deteksi format gambar dari magic bytes base64.
 * Telegram selalu kirim JPEG, tapi gambar lain bisa PNG/WebP.
 * Tanpa ini, API OpenAI error "invalid_image_file" karena MIME type salah.
 */
function detectImageFormat(base64String) {
  const header = Buffer.from(base64String.substring(0, 16), 'base64');
  // JPEG: FF D8 FF
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  // WebP: RIFF....WEBP
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  // Default: JPEG (Telegram selalu JPEG)
  return { ext: 'jpg', mime: 'image/jpeg' };
}

/**
 * Helper: Konversi base64 ke File object dengan format yang terdeteksi otomatis.
 */
async function base64ToFile(base64String, namePrefix = 'image') {
  const { ext, mime } = detectImageFormat(base64String);
  const stream = base64ToReadable(base64String);
  return toFile(stream, `${namePrefix}.${ext}`, { type: mime });
}

const ImageService = {

  // ─────────────────────────────────────────────────────────────────────────
  // Generate image:
  //   - Jika ada aset (base64), gunakan images.edit() → image-to-image
  //     sehingga aset BENAR-BENAR dimasukkan ke dalam output desain.
  //   - Jika tidak ada aset, gunakan images.generate() → text-to-image biasa.
  // ─────────────────────────────────────────────────────────────────────────
  async generate(prompt, asetImageBase64 = null, size = "1024x1792") {
    try {

      // ── Mode image-to-image: ada aset → gunakan images.edit() ──
      if (asetImageBase64) {
        console.log("⏳ Mode image-to-image: generate dengan aset gambar...");

        const asetArray = Array.isArray(asetImageBase64) ? asetImageBase64 : [asetImageBase64];
        
        // Konversi semua aset ke File objects dengan format yang terdeteksi otomatis
        const asetFiles = await Promise.all(
          asetArray.map((b64, i) => base64ToFile(b64, `aset_${i}`))
        );

        const response = await openai.images.edit({
          model: "gpt-image-2",
          image: asetFiles.length === 1 ? asetFiles[0] : asetFiles,
          prompt: prompt,
          size: size,
          quality: "medium",
        });

        const data = response.data[0];
        let base64;

        if (data.b64_json) {
          base64 = data.b64_json;
        } else if (data.url) {
          const imageResponse = await fetch(data.url);
          const arrayBuffer = await imageResponse.arrayBuffer();
          base64 = Buffer.from(arrayBuffer).toString('base64');

        } else {
          throw new Error("Format gambar tidak dikenali dari API OpenAI (edit)");
        }

        return { success: true, imageBase64: base64 };
      }

      // ── Mode text-to-image: tidak ada aset ──
      console.log("⏳ Mode text-to-image: generate tanpa aset...");

      const response = await openai.images.generate({
        model: "gpt-image-2",
        prompt: prompt,
        n: 1,
        size: size,
      });

      const data = response.data[0];
      let base64;

      if (data.b64_json) {
        base64 = data.b64_json;
      } else if (data.url) {
        const imageResponse = await fetch(data.url);
        const arrayBuffer = await imageResponse.arrayBuffer();
        base64 = Buffer.from(arrayBuffer).toString('base64');
      } else {
        throw new Error("Format gambar tidak dikenali dari API OpenAI (generate)");
      }

      return { success: true, imageBase64: base64 };

    } catch (error) {
      console.error('Image generation error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Generate poster dengan referensi (2 langkah):
  //   Langkah 1 → GPT-4o menganalisis SEMUA gambar aset + SEMUA referensi → ultra-detail prompt
  //   Langkah 2 → gpt-image-2 images.edit() dengan array aset + prompt
  //
  // @param {string[]|string} base64AsetArray      - Array (atau single) base64 gambar aset
  // @param {string[]|string} base64ReferensiArray - Array (atau single) base64 gambar referensi
  // @param {string}          instruksiTambahan    - Instruksi spesifik user
  // @param {string}          size                 - Ukuran output
  // ─────────────────────────────────────────────────────────────────────────
  async generateWithReference(base64AsetArray, base64ReferensiArray, instruksiTambahan = "", size = "1024x1536") {
    try {

      // Normalisasi: bisa single string atau array
      const asetArray = Array.isArray(base64AsetArray) ? base64AsetArray : [base64AsetArray];
      const refArray  = Array.isArray(base64ReferensiArray) ? base64ReferensiArray : [base64ReferensiArray];
      
      console.log("⏳ [1/2] GPT-4o menganalisis gambar...");

      const openaiChat = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_IMAGE_KEY });

      const contentItems = [{
        type: "text",
        text: `You are a world-class professional graphic designer and prompt engineer with expert-level proficiency in Canva, Adobe Illustrator, and Adobe Photoshop.
You will receive ${asetArray.length + refArray.length} image(s) total:
- First ${asetArray.length} image(s) are ASSETS: PRIMARY visual content that MUST all be incorporated prominently in the final design.
- Last ${refArray.length} image(s) are REFERENCES: Finished design examples — replicate their layout, style, color palette, and composition.

Write ONE highly detailed image generation prompt in English covering:
1. LAYOUT (from references): Exact layout zones, colors with hex descriptions, geometric dividers, background texture.
2. TYPOGRAPHY (from references): Every text element — position, size, weight, style, color, and ALL actual text content verbatim.
3. GRAPHICAL ELEMENTS (from references): All badges, icons, shapes, overlays, decorative elements with positions and styles.
4. PRIMARY ASSET(S) (from assets): Describe each asset accurately. Specify exact placement in the design. All assets must appear integrated naturally and unchanged.
5. ADDITIONAL INSTRUCTION: ${instruksiTambahan}

Write as one cohesive structured paragraph. The result must look like professional Canva Pro or Adobe Photoshop work.
Respond in English only.`
      }];

      // Tambahkan semua gambar aset
      asetArray.forEach((b64) => {
        contentItems.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
      });

      // Tambahkan semua gambar referensi
      refArray.forEach((b64) => {
        contentItems.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}`, detail: "high" } });
      });

      const analisis = await openaiChat.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: contentItems }],
        max_tokens: 1500
      });

      const promptUltraDetail = analisis.choices[0].message.content;
      
      // ── LANGKAH 2: gpt-image-2 generate poster pakai prompt ultra-detail ──
      console.log("\n⏳ [2/2] Generating poster dengan gpt-image-2...");

      const asetFiles = await Promise.all(
        asetArray.map((b64, i) => base64ToFile(b64, `aset_${i}`))
      );

      const response = await openai.images.edit({
        model: "gpt-image-2",
        image: asetFiles.length === 1 ? asetFiles[0] : asetFiles,
        prompt: promptUltraDetail,
        size: size,
        quality: "medium",
      });

      const data = response.data[0];
      let base64Result;

      if (data.b64_json) {
        base64Result = data.b64_json;
      } else if (data.url) {
        const imageResponse = await fetch(data.url);
        const arrayBuffer = await imageResponse.arrayBuffer();
        base64Result = Buffer.from(arrayBuffer).toString('base64');
      } else {
        throw new Error("Format gambar tidak dikenali dari API OpenAI");
      }

      console.log("\n✅ [2/2] Poster berhasil digenerate!");

      return {
        success: true,
        imageBase64: base64Result,
        generatedPrompt: promptUltraDetail, // Kembalikan prompt agar bisa ditampilkan ke user
      };

    } catch (error) {
      console.error('generateWithReference error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },

  // Convert base64 ke Buffer untuk dikirim via Telegram
  base64ToBuffer(base64String) {
    return Buffer.from(base64String, 'base64');
  },
};

module.exports = ImageService;
