const db = require('../db');

const EXPIRY_HOURS = parseInt(process.env.SESSION_EXPIRY_HOURS || '24');

const SessionService = {

  // Upsert user
  async upsertUser(telegramUser) {
    const { id, username, first_name } = telegramUser;
    console.log(`   [DB] upsertUser → id=${id} username=@${username} first_name=${first_name}`);
    await db.query(`
      INSERT INTO telegram_users (id, username, first_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
        SET username = $2,
            first_name = $3,
            updated_at = NOW()
    `, [id, username, first_name]);
    console.log(`   [DB] upsertUser → OK`);
  },

  // Get active (non-expired) session for user
  async getSession(userId) {
    console.log(`   [DB] getSession → userId=${userId}`);
    const result = await db.query(`
      SELECT * FROM sessions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);
    const session = result.rows[0] || null;
    if (session) {
      console.log(`   [DB] getSession → found step='${session.step}' expires_at=${session.expires_at}`);
    } else {
      console.log(`   [DB] getSession → no session found`);
    }
    return session;
  },

  // Check if session is expired
  isExpired(session) {
    if (!session) return true;
    return new Date() > new Date(session.expires_at);
  },

  // Create new session
  async createSession(userId) {
    console.log(`   [DB] createSession → userId=${userId} (hapus sesi lama, buat baru)`);
    // Delete old sessions for this user
    await db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);

    const result = await db.query(`
      INSERT INTO sessions (user_id, step, data, expires_at)
      VALUES ($1, 'prompting', '{}', NOW() + INTERVAL '${EXPIRY_HOURS} hours')
      RETURNING *
    `, [userId]);
    console.log(`   [DB] createSession → OK id=${result.rows[0]?.id}`);
    return result.rows[0];
  },

  // Update session step and data
  async updateSession(userId, step, newData = {}) {
    console.log(`   [DB] updateSession → userId=${userId} step='${step}'`);
    const result = await db.query(`
      UPDATE sessions
      SET step = $2,
          data = data || $3::jsonb,
          last_active = NOW(),
          expires_at = NOW() + INTERVAL '${EXPIRY_HOURS} hours'
      WHERE user_id = $1
      RETURNING *
    `, [userId, step, JSON.stringify(newData)]);
    if (!result.rows[0]) console.warn(`   [DB] updateSession → WARNING: tidak ada row yang terupdate untuk userId=${userId}`);
    else console.log(`   [DB] updateSession → OK`);
    return result.rows[0];
  },

  // Save generated image to session
  async saveImage(userId, imageUrl, prompt) {
    await db.query(`
      UPDATE sessions
      SET last_image_url = $2,
          last_prompt = $3,
          revision_count = revision_count + 1,
          last_active = NOW(),
          expires_at = NOW() + INTERVAL '7 days'
      WHERE user_id = $1
    `, [userId, imageUrl, prompt]);
  },

  // Delete session (start fresh)
  async deleteSession(userId) {
    await db.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  },

  // Save to generation history
  async saveGeneration(userId, sessionId, prompt, imageUrl, designType, status = 'success') {
    console.log(`   [DB] saveGeneration → userId=${userId} designType=${designType} status=${status} imageUrl=${imageUrl ? 'set' : 'null'}`);
    await db.query(`
      INSERT INTO generations (user_id, session_id, prompt, image_url, design_type, status)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [userId, sessionId, prompt, imageUrl, designType, status]);
    console.log(`   [DB] saveGeneration → OK`);
  },

  // Save generated asset to Supabase Storage and DB
  async saveAssetLocally(userId, imageBase64, metadata = {}) {
    const { createClient } = require('@supabase/supabase-js');
    
    // Fallback if not configured
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      console.warn(`   [SUPABASE] ⚠️ SUPABASE_URL atau SUPABASE_KEY tidak diset. Upload dilewati.`);
      return null;
    }
    console.log(`   [SUPABASE] saveAssetLocally → userId=${userId} uploading...`);

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    
    const filename = `${userId}/asset_${Date.now()}.png`;
    const buffer = Buffer.from(imageBase64, 'base64');

    // Upload to Supabase bucket 'asset-telegram'
    const { data, error } = await supabase.storage
      .from('asset-telegram')
      .upload(filename, buffer, {
        contentType: 'image/png',
        upsert: true
      });

    if (error) {
      console.error(`   [SUPABASE] ❌ Gagal upload ke Supabase:`, error.message, error);
      return null;
    }
    console.log(`   [SUPABASE] Upload OK → file: ${filename}`);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('asset-telegram')
      .getPublicUrl(filename);
      
    const publicUrl = urlData.publicUrl;

    // Save to PostgreSQL assets table
    await db.query(`
      INSERT INTO assets (user_id, file_path, metadata)
      VALUES ($1, $2, $3)
    `, [userId, publicUrl, JSON.stringify(metadata)]);

    return publicUrl;
  },
  
  // Cleanup old assets (now deletes from Supabase as well)
  async cleanupOldAssets() {
    const { createClient } = require('@supabase/supabase-js');
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return;
    
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

    // Cari semua assets yang usianya lebih dari 14 hari
    const result = await db.query(`
      SELECT id, file_path FROM assets
      WHERE created_at < NOW() - INTERVAL '14 days'
    `);
    
    for (const row of result.rows) {
      const publicUrl = row.file_path;
      // Extract filename from public URL (e.g. https://.../storage/v1/object/public/asset-telegram/123/asset_456.png)
      // Path di bucket adalah: userId/asset_...png
      const matches = publicUrl.match(/asset-telegram\/(.*)$/);
      if (matches && matches[1]) {
        const filePathInBucket = matches[1];
        try {
          await supabase.storage.from('asset-telegram').remove([filePathInBucket]);
        } catch (e) {
          console.error("Gagal menghapus file di Supabase:", filePathInBucket, e);
        }
      }
      // Hapus record dari db
      await db.query(`DELETE FROM assets WHERE id = $1`, [row.id]);
    }
  }
};

module.exports = SessionService;
