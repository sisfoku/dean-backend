const SessionService = require('../services/sessionService');
const AIService = require('../services/aiService');
const ImageService = require('../services/imageService');

// ─── Helper: Bangun pesan konfirmasi dengan 4 opsi tombol ────────────────────
function buildConfirmationMenu(summaryId, englishPrompt, title = 'Berikut kesimpulan desainmu:') {
  return (
    `📋 *${title}*\n\n` +
    `${summaryId}\n\n` +
    `✨ *Prompt AI (Inggris):*\n${englishPrompt}\n\n` +
    `_Apakah kesimpulan ini sudah benar?_\n\n` +
    `✅ Ketik *sudah* → langsung generate gambar\n` +
    `✏️ Ketik *revisi* → ubah teks deskripsi\n` +
    `🖼️ Ketik *aset* → tambahkan gambar/foto aset desain\n` +
    `🎨 Ketik *referensi* → tambahkan gambar referensi gaya desain`
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const FlowHandler = {

  // ─── Generate & kirim gambar ke user ─────────────────────────────────────
  async generateAndSendImage(bot, userId, session) {
    const asetImages      = session.data.aset_images || [];
    const referensiImages = session.data.referensi_images;
    const instruksiUser   = session.data.summary_id || session.data.summary || '';

    // Mode generateWithReference: ada gambar aset DAN minimal 1 referensi
    if (asetImages.length > 0 && referensiImages && referensiImages.length > 0) {
      await bot.sendMessage(
        userId,
        `⏳ *Sedang menganalisis ${asetImages.length} gambar aset & referensi dengan GPT-4o, lalu membuat poster...*\n\nProses ini memakan waktu 60–120 detik. Mohon tunggu ya! 🙏`,
        { parse_mode: 'Markdown' }
      );

      const imageSize = session.data.image_size || '1024x1536';

      const result = await ImageService.generateWithReference(
        asetImages,           // array aset
        referensiImages,      // array referensi (semua)
        instruksiUser,
        imageSize
      );

      if (result.success) {
        const imageBuffer = ImageService.base64ToBuffer(result.imageBase64);
        const publicUrl = await SessionService.saveAssetLocally(userId, result.imageBase64, { prompt: result.generatedPrompt });

        await bot.sendPhoto(userId, imageBuffer, {
          caption:
            `✅ *Poster berhasil dibuat!*\n\n` +
            `🤖 *Prompt AI yang digunakan:*\n${result.generatedPrompt.substring(0, 800)}${result.generatedPrompt.length > 800 ? '...' : ''}\n\n` +
            `Mau mulai desain baru? Ketik /baru\nIngin perbaiki desain ini? Ketik *revisi*`,
          parse_mode: 'Markdown',
        });

        await SessionService.saveImage(userId, publicUrl, result.generatedPrompt);
        await SessionService.saveGeneration(userId, session.id, result.generatedPrompt, publicUrl, 'with_reference');
        await SessionService.updateSession(userId, 'selesai', { last_image_base64: result.imageBase64 });
      } else {
        await bot.sendMessage(userId, `❌ Maaf, gagal generate poster. Error: ${result.error}\n\nKetik /baru untuk mulai ulang.`);
        await SessionService.saveGeneration(userId, session.id, instruksiUser, null, 'with_reference', 'failed');
      }
      return;
    }

    // Mode generate biasa (text-to-image, atau image-to-image jika ada aset)
    await bot.sendMessage(
      userId,
      '⏳ *Sedang membuat desainmu...*\n\nMohon tunggu 30–60 detik ya!',
      { parse_mode: 'Markdown' }
    );

    const finalPrompt = session.data.summary;
    const imageSize   = session.data.image_size || '1024x1792';
    // Teruskan aset_images agar generate() pakai image-to-image jika ada aset
    const result = await ImageService.generate(finalPrompt, asetImages.length > 0 ? asetImages : null, imageSize);

    if (result.success) {
      const imageBuffer = ImageService.base64ToBuffer(result.imageBase64);
      const publicUrl = await SessionService.saveAssetLocally(userId, result.imageBase64, { prompt: finalPrompt });

      await bot.sendPhoto(userId, imageBuffer, {
        caption:
          `✅ *Desainmu sudah jadi!*\n\n` +
          `Mau mulai desain baru? Ketik /baru\nIngin perbaiki desain ini? Ketik *revisi*`,
        parse_mode: 'Markdown',
      });

      await SessionService.saveImage(userId, publicUrl, finalPrompt);
      await SessionService.saveGeneration(userId, session.id, finalPrompt, publicUrl, 'freeform');
      // Simpan base64 gambar terakhir agar bisa dipakai sebagai base revisi image-to-image
      await SessionService.updateSession(userId, 'selesai', { last_image_base64: result.imageBase64 });
    } else {
      await bot.sendMessage(userId, `❌ Maaf, gagal generate gambar. Error: ${result.error}\n\nKetik /baru untuk mulai ulang.`);
      await SessionService.saveGeneration(userId, session.id, finalPrompt, null, 'freeform', 'failed');
    }
  },

  // ─── Main handler ─────────────────────────────────────────────────────────
  async handle(bot, msg) {
    const userId = msg.chat.id;
    const text   = msg.text?.trim();
    const photo  = msg.photo;

    if (!text && !photo) return;

    // Upsert user ke DB
    await SessionService.upsertUser({
      id:         userId,
      username:   msg.chat.username,
      first_name: msg.chat.first_name,
    });

    // ── /start atau /baru ──────────────────────────────────────────────────
    if (text === '/start' || text === '/baru' || ['baru', 'start'].includes(text?.toLowerCase())) {
      await SessionService.createSession(userId);
      return bot.sendMessage(
        userId,
        '🎨 *Halo!* Silakan berikan deskripsi atau prompt bebas tentang desain yang ingin kamu buat.\n\n' +
        'Contoh: "Buat poster promosi skincare bergaya minimalis", "Banner event music festival", "Konten Instagram brand fashion"',
        { parse_mode: 'Markdown' }
      );
    }

    // ── Ambil session ──────────────────────────────────────────────────────
    let session = await SessionService.getSession(userId);

    if (!session || SessionService.isExpired(session)) {
      await SessionService.createSession(userId);
      return bot.sendMessage(
        userId,
        '🎨 *Halo!* Sesi kamu telah berakhir. Silakan berikan deskripsi desain yang ingin kamu buat.\n\n' +
        'Contoh: "Poster event konser minimalis", "Flyer promosi kafe bergaya retro", "Thumbnail YouTube gaming"',
        { parse_mode: 'Markdown' }
      );
    }

    const currentStep = session.step;

    // ══════════════════════════════════════════════════════════════════════
    // STEP 1 ─ prompting: user memberikan prompt pertama kali
    // ══════════════════════════════════════════════════════════════════════
    if (currentStep === 'prompting') {
      if (!text) return bot.sendMessage(userId, '📝 Silakan kirimkan deskripsi teks desain kamu terlebih dahulu.');

      await bot.sendMessage(userId, '⏳ *Sedang menyusun kesimpulan dari prompt kamu...*', { parse_mode: 'Markdown' });

      const summaryResult = await AIService.summarizePrompt(text);
      if (!summaryResult) {
        return bot.sendMessage(userId, '❌ Maaf, terjadi kesalahan saat menyusun kesimpulan. Coba ulangi prompt kamu.');
      }

      await SessionService.updateSession(userId, 'konfirmasi', {
        summary:    summaryResult.english_prompt,
        summary_id: summaryResult.summary_id,
        image_size: summaryResult.image_size,
        // Reset semua input tambahan
        aset_image:       null,
        referensi_images: [],
      });

      return bot.sendMessage(
        userId,
        buildConfirmationMenu(summaryResult.summary_id, summaryResult.english_prompt),
        { parse_mode: 'Markdown' }
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 2 ─ konfirmasi: user memilih 1 dari 4 opsi
    // ══════════════════════════════════════════════════════════════════════
    if (currentStep === 'konfirmasi') {
      if (!text) return bot.sendMessage(userId, '📝 Silakan balas dengan teks: *sudah / revisi / aset / referensi*', { parse_mode: 'Markdown' });

      const lowerText = text.toLowerCase().trim();

      // ── Opsi 1: SUDAH → langsung generate ──────────────────────────────
      if (['sudah', 'ya', 'yes', 'benar', 'betul', 'oke', 'ok', 'lanjut', 'gas'].includes(lowerText)) {
        return this.generateAndSendImage(bot, userId, session);
      }

      // ── Opsi 2: REVISI → tunggu teks revisi ────────────────────────────
      if (lowerText === 'revisi') {
        await SessionService.updateSession(userId, 'menunggu_revisi', { ...session.data });
        return bot.sendMessage(
          userId,
          '✏️ *Silakan masukkan teks revisi kamu.*\n\nContoh: "Tambahkan harga 500 juta, warna lebih cerah"\n\nSetelah kamu ketik, kesimpulan akan diperbarui otomatis.',
          { parse_mode: 'Markdown' }
        );
      }

      // ── Opsi 3: ASET → tunggu foto/gambar aset desain ─────────────────
      if (['aset', 'foto', 'foto aset', 'gambar aset', 'punya foto', 'ada foto', 'foto rumah', 'foto properti'].includes(lowerText)) {
        await SessionService.updateSession(userId, 'menunggu_aset', {
          ...session.data,
          aset_images: [],
          aset_notes:  [],
        });
        return bot.sendMessage(
          userId,
          '🖼️ *Kirimkan gambar/foto aset* yang ingin dimasukkan ke dalam desain.\n\n' +
          'Ini bisa berupa foto produk, foto orang, gambar logo, foto lokasi, atau gambar apapun yang ingin dijadikan elemen utama desainmu.\n\n' +
          '✅ Boleh kirim *lebih dari 1 gambar* — semua akan dimasukkan ke desain!\n' +
          'Boleh tambahkan catatan teks (instruksi tambahan, keterangan, dll.).\n' +
          'Kalau sudah, ketik *sudah* untuk kembali ke kesimpulan.',
          { parse_mode: 'Markdown' }
        );
      }

      // ── Opsi 4: REFERENSI → tunggu gambar referensi gaya desain ────────
      if (['referensi', 'punya referensi', 'ada referensi'].includes(lowerText)) {
        await SessionService.updateSession(userId, 'menunggu_referensi', {
          ...session.data,
          referensi_notes:  [],
          referensi_images: [],
        });
        return bot.sendMessage(
          userId,
          '🎨 *Kirimkan gambar referensi gaya desain* yang ingin kamu tiru.\n\n' +
          'Ini bisa berupa screenshot template Canva, contoh poster/flyer/banner, atau desain apapun yang kamu suka gayanya.\n\n' +
          'Boleh kirim lebih dari satu gambar dan tambahkan catatan teks.\n' +
          'Kalau sudah, ketik *sudah* untuk kembali ke kesimpulan.',
          { parse_mode: 'Markdown' }
        );
      }

      // ── Fallback: input tidak dikenali → tampilkan ulang menu ───────────
      return bot.sendMessage(
        userId,
        '❓ Pilihan tidak dikenali. Silakan balas dengan salah satu:\n\n' +
        '✅ *sudah* → generate gambar sekarang\n' +
        '✏️ *revisi* → ubah deskripsi desain\n' +
        '🖼️ *aset* → kirim gambar/foto aset desain\n' +
        '🎨 *referensi* → kirim gambar referensi gaya desain',
        { parse_mode: 'Markdown' }
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 3a ─ menunggu_revisi: user mengetik teks revisi
    //           → jika ada gambar AI sebelumnya → image-to-image edit langsung
    //           → jika tidak ada → AI update summary → kembali ke konfirmasi
    // ══════════════════════════════════════════════════════════════════════
    if (currentStep === 'menunggu_revisi') {
      if (!text) return bot.sendMessage(userId, '📝 Silakan masukkan teks revisi kamu.');

      const lastImageBase64 = session.data.last_image_base64 || null;

      // ── Mode image-to-image revisi: ada gambar hasil AI sebelumnya ──────
      if (lastImageBase64) {
        await bot.sendMessage(
          userId,
          '⏳ *Menerapkan revisi ke desain sebelumnya...*\n\nProses ini memakan waktu 30–60 detik. Mohon tunggu! 🙏',
          { parse_mode: 'Markdown' }
        );

        // Bangun prompt revisi: gabungkan summary lama + instruksi revisi baru
        const prevSummary = session.data.summary || '';
        const revisionPrompt = prevSummary
          ? `${prevSummary}\n\nIMPORTANT REVISION: ${text}. Apply ONLY this change to the existing design. Keep all other elements intact.`
          : text;

        const imageSize = session.data.image_size || '1024x1792';
        const result = await ImageService.generate(revisionPrompt, lastImageBase64, imageSize);

        if (result.success) {
          const imageBuffer = ImageService.base64ToBuffer(result.imageBase64);
          const publicUrl = await SessionService.saveAssetLocally(userId, result.imageBase64, { prompt: revisionPrompt });

          await bot.sendPhoto(userId, imageBuffer, {
            caption:
              `✅ *Revisi berhasil diterapkan!*\n\n` +
              `✏️ *Instruksi revisi:* ${text}\n\n` +
              `Mau revisi lagi? Ketik *revisi*\nMau mulai desain baru? Ketik /baru`,
            parse_mode: 'Markdown',
          });

          await SessionService.saveImage(userId, publicUrl, revisionPrompt);
          await SessionService.saveGeneration(userId, session.id, revisionPrompt, publicUrl, 'revision');
          // Update gambar terakhir agar revisi berikutnya juga bisa berbasis gambar ini
          await SessionService.updateSession(userId, 'selesai', {
            ...session.data,
            last_image_base64: result.imageBase64,
          });
        } else {
          await bot.sendMessage(userId, `❌ Maaf, gagal menerapkan revisi. Error: ${result.error}\n\nKetik *revisi* untuk coba lagi, atau /baru untuk mulai ulang.`);
          // Kembali ke state selesai tanpa mengubah gambar
          await SessionService.updateSession(userId, 'selesai', { ...session.data });
        }
        return;
      }

      // ── Mode fallback: tidak ada gambar sebelumnya → update summary biasa ─
      await bot.sendMessage(userId, '⏳ *Sedang merevisi kesimpulan desainmu...*', { parse_mode: 'Markdown' });

      const prevContext = session.data.summary_id || session.data.summary;
      const newSummaryResult = await AIService.summarizePrompt(text, prevContext);

      if (!newSummaryResult) {
        return bot.sendMessage(userId, '❌ Maaf, terjadi kesalahan saat merevisi. Coba ketik ulang revisinya.');
      }

      await SessionService.updateSession(userId, 'konfirmasi', {
        ...session.data,
        summary:    newSummaryResult.english_prompt,
        summary_id: newSummaryResult.summary_id,
        image_size: newSummaryResult.image_size || session.data.image_size,
      });

      return bot.sendMessage(
        userId,
        buildConfirmationMenu(newSummaryResult.summary_id, newSummaryResult.english_prompt, 'Kesimpulan desainmu yang direvisi:'),
        { parse_mode: 'Markdown' }
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 3b ─ menunggu_aset: user kirim foto properti (+ catatan opsional)
    //           → ketik "sudah" → AI update summary → kembali ke konfirmasi
    // ══════════════════════════════════════════════════════════════════════
    if (currentStep === 'menunggu_aset') {
      const lowerText = text ? text.toLowerCase().trim() : '';

      const asetImages = session.data.aset_images || [];
      const asetNotes  = session.data.aset_notes  || [];

      // ── User berkata sudah ─────────────────────────────────────────────
      if (lowerText === 'sudah' || lowerText === 'done' || lowerText === 'selesai') {
        if (asetImages.length === 0) {
          return bot.sendMessage(userId, '❌ Kamu belum mengirimkan gambar aset. Silakan kirim dulu, atau ketik /baru untuk batal.');
        }

        await bot.sendMessage(userId, `⏳ *Memproses ${asetImages.length} gambar aset dan memperbarui kesimpulan...*`, { parse_mode: 'Markdown' });

        const catatanAset = asetNotes.join('\n');
        const prevContext = session.data.summary_id || session.data.summary || '';
        const konteks = prevContext + (catatanAset ? `\n\nCatatan aset: ${catatanAset}` : '');

        const newSummaryResult = await AIService.summarizePrompt(
          `${asetImages.length} gambar aset telah diterima dan akan diintegrasikan ke dalam desain sebagai elemen visual utama. ${catatanAset ? 'Catatan user: ' + catatanAset : 'Gunakan semua gambar aset sebagai elemen utama dalam desain.'}`,
          konteks
        );

        const updatedData = {
          ...session.data,
          aset_images: asetImages,
          aset_notes:  asetNotes,
        };

        if (newSummaryResult) {
          updatedData.summary    = newSummaryResult.english_prompt;
          updatedData.summary_id = newSummaryResult.summary_id;
          updatedData.image_size = newSummaryResult.image_size || session.data.image_size;
        }

        await SessionService.updateSession(userId, 'konfirmasi', updatedData);

        const summaryToShow = updatedData.summary_id || updatedData.summary || '(Gunakan gambar aset sebagai elemen utama desain)';
        const promptToShow  = updatedData.summary || '';
        return bot.sendMessage(
          userId,
          buildConfirmationMenu(summaryToShow, promptToShow, `Kesimpulan diperbarui dengan ${asetImages.length} gambar aset:`),
          { parse_mode: 'Markdown' }
        );
      }

      // ── Collect catatan teks ───────────────────────────────────────────
      if (text && lowerText !== 'aset' && lowerText !== 'referensi') {
        asetNotes.push(text);
      }

      // ── Collect foto (multiple) ────────────────────────────────────────
      if (photo && photo.length > 0) {
        const fileId = photo[photo.length - 1].file_id;
        try {
          const fileLink      = await bot.getFileLink(fileId);
          const fetchResponse = await fetch(fileLink);
          const arrayBuffer   = await fetchResponse.arrayBuffer();
          const base64        = Buffer.from(arrayBuffer).toString('base64');

          asetImages.push(base64);
          await SessionService.updateSession(userId, 'menunggu_aset', {
            ...session.data,
            aset_images: asetImages,
            aset_notes:  asetNotes,
          });
          return bot.sendMessage(
            userId,
            `✅ *Gambar aset ke-${asetImages.length} diterima!*\n\n` +
            `📝 Boleh kirim gambar aset lagi, tambahkan catatan, atau ketik *sudah* kalau sudah selesai.`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          console.error('Gagal mendownload gambar aset:', e);
          return bot.sendMessage(userId, '❌ Gagal membaca gambarmu. Coba kirim ulang.');
        }
      }

      // Update session dengan catatan baru (jika ada)
      await SessionService.updateSession(userId, 'menunggu_aset', {
        ...session.data,
        aset_images: asetImages,
        aset_notes:  asetNotes,
      });

      return bot.sendMessage(
        userId,
        asetImages.length > 0
          ? `✅ _Catatan dicatat!_ (${asetImages.length} gambar aset tersimpan) Ketik *sudah* kalau sudah selesai, atau kirim gambar/catatan lagi.`
          : '🖼️ _Catatan dicatat!_ Silakan kirim gambar/foto aset yang ingin dimasukkan ke desainmu.',
        { parse_mode: 'Markdown' }
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 3c ─ menunggu_referensi: user kirim gambar referensi desain
    //           → ketik "sudah" → AI analisis referensi → kembali ke konfirmasi
    // ══════════════════════════════════════════════════════════════════════
    if (currentStep === 'menunggu_referensi') {
      const lowerText = text ? text.toLowerCase().trim() : '';

      const referensiNotes  = session.data.referensi_notes  || [];
      const referensiImages = session.data.referensi_images || [];

      // ── User berkata sudah ──────────────────────────────────────────────
      if (lowerText === 'sudah' || lowerText === 'done' || lowerText === 'selesai') {
        if (referensiNotes.length === 0 && referensiImages.length === 0) {
          return bot.sendMessage(userId, '❌ Kamu belum memberikan gambar atau catatan apapun. Silakan kirim referensi desainnya, atau ketik /baru untuk batal.');
        }

        await bot.sendMessage(userId, '⏳ *Menganalisis referensi desain dan memperbarui kesimpulan...*', { parse_mode: 'Markdown' });

        const combinedNotes = referensiNotes.join('\n');
        const prevContext   = session.data.summary_id || session.data.summary;

        try {
          const newSummaryResult = await AIService.analyzeMultipleImagesAndSummarize(
            prevContext,
            referensiImages,
            combinedNotes
          );

          if (!newSummaryResult) {
            return bot.sendMessage(userId, '❌ Maaf, terjadi kesalahan saat menganalisis referensi. Coba ketik /baru.');
          }

          await SessionService.updateSession(userId, 'konfirmasi', {
            ...session.data,
            summary:          newSummaryResult.english_prompt,
            summary_id:       newSummaryResult.summary_id,
            image_size:       newSummaryResult.image_size || session.data.image_size,
            referensi_images: referensiImages, // Simpan untuk generateWithReference jika ada aset
          });

          return bot.sendMessage(
            userId,
            buildConfirmationMenu(newSummaryResult.summary_id, newSummaryResult.english_prompt, 'Kesimpulan diperbarui dengan referensi visual:'),
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          console.error('Compile referensi error:', e);
          return bot.sendMessage(userId, '❌ Gagal menganalisis referensi. Ketik /baru untuk mengulang.');
        }
      }

      // ── Collect catatan teks ────────────────────────────────────────────
      if (text) referensiNotes.push(text);

      // ── Collect foto referensi ──────────────────────────────────────────
      if (photo && photo.length > 0) {
        const fileId = photo[photo.length - 1].file_id;
        try {
          const fileLink      = await bot.getFileLink(fileId);
          const fetchResponse = await fetch(fileLink);
          const arrayBuffer   = await fetchResponse.arrayBuffer();
          const base64        = Buffer.from(arrayBuffer).toString('base64');
          referensiImages.push(base64);
        } catch (e) {
          console.error('Gagal mendownload gambar referensi:', e);
          return bot.sendMessage(userId, '❌ Gagal membaca gambarmu. Coba kirim ulang gambar tersebut.');
        }
      }

      await SessionService.updateSession(userId, 'menunggu_referensi', {
        ...session.data,
        referensi_notes:  referensiNotes,
        referensi_images: referensiImages,
      });

      return bot.sendMessage(
        userId,
        `✅ _${referensiImages.length > 0 ? `${referensiImages.length} gambar referensi` : 'Catatan'} diterima!_ ` +
        `Kirim lagi atau ketik *sudah* kalau sudah selesai.`,
        { parse_mode: 'Markdown' }
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 4 ─ selesai: desain sudah digenerate, user bisa mulai baru / revisi
    // ══════════════════════════════════════════════════════════════════════
    if (currentStep === 'selesai') {
      if (text && text.toLowerCase().trim() === 'revisi') {
        await SessionService.updateSession(userId, 'menunggu_revisi', {
          ...session.data,
        });
        const hasLastImage = !!session.data.last_image_base64;
        return bot.sendMessage(
          userId,
          '✏️ *Silakan masukkan teks revisi kamu.*\n\n' +
          (hasLastImage
            ? '🖼️ _Revisi akan diterapkan langsung ke desain terakhir (image-to-image)._\n\n'
            : '') +
          'Contoh: "Ganti warna latar menjadi merah", "Tambahkan teks SALE 50% di pojok kanan atas", "Buat font headline lebih besar"',
          { parse_mode: 'Markdown' }
        );
      }
      return bot.sendMessage(
        userId,
        '✅ Desain sebelumnya sudah selesai.\n\n' +
        'Ketik /baru untuk membuat desain baru.\n' +
        'Atau ketik *revisi* jika ingin memperbaiki desain terakhir.',
        { parse_mode: 'Markdown' }
      );
    }
  },
};

module.exports = FlowHandler;
