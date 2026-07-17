const PromptService = {

  // Build final prompt dari semua data yang terkumpul
  build(data) {
    const {
      jenis,
      gaya,
      warna,
      headline,
      subtext,
      harga,
      cicilan,
      tipe_rumah,
      fasilitas,
      gratis,
      lokasi,
      no_wa,
      bahasa,
      referensi_gaya,
    } = data;

    // Map pilihan user ke instruksi visual
    const gayaMap = {
      '1': 'modern minimalist, clean white space, sharp typography',
      '2': 'bold and vibrant, high contrast colors, eye-catching',
      '3': 'elegant, luxury feel, gold accents, sophisticated',
      '4': 'earthy natural tones, green and cream palette, local Indonesian feel',
    };

    const warnaMap = {
      'hijau': '#2D6A4F green dominant',
      'biru': '#1A4F8C blue dominant',
      'ungu': '#5C3A8A purple dominant',
      'merah': '#C0392B red accent',
      'emas': 'gold and dark navy luxury palette',
      'natural': 'earthy green, cream, and brown tones',
    };

    const visualStyle = gayaMap[gaya] || gaya || 'modern professional';
    const colorScheme = warnaMap[warna?.toLowerCase()] || warna || 'blue and white';

    // Susun fasilitas jadi teks
    const fasilitasList = Array.isArray(fasilitas)
      ? fasilitas.join(', ')
      : fasilitas || '';

    // Susun benefit gratis
    const gratisList = Array.isArray(gratis)
      ? gratis.map(g => `Free ${g}`).join(', ')
      : gratis || '';

    const prompt = `
Create a professional Indonesian real estate promotion poster with the following specifications:

DESIGN STYLE:
- Style: ${visualStyle}
- Color scheme: ${colorScheme}
- Layout: Portrait orientation (1080x1350px ratio)
- Typography: Bold, clean, easy to read in Indonesian market style
- Overall feel: ${referensi_gaya || 'modern Indonesian property poster'}

CONTENT TO INCLUDE:
- Main headline (large, prominent): "${headline || 'Rumah Impian Anda'}"
${subtext ? `- Sub-headline: "${subtext}"` : ''}
${harga ? `- Price badge: "Harga Mulai ${harga}" (make it visually prominent)` : ''}
${cicilan ? `- Installment badge: "Cicilan ${cicilan}/bulan"` : ''}
${tipe_rumah ? `- House type label: "Tipe ${tipe_rumah}"` : ''}
${fasilitasList ? `- Facility icons row at bottom with labels: ${fasilitasList}` : ''}
${gratisList ? `- "GRATIS" badge or banner highlighting: ${gratisList}` : ''}
${lokasi ? `- Location text with pin icon: "${lokasi}"` : ''}
${no_wa ? `- WhatsApp contact with icon: "${no_wa}"` : ''}

VISUAL ELEMENTS:
- Beautiful modern Indonesian house as the hero image (single story or two story depending on type)
- Clear blue sky with soft white clouds as background
- Lush green garden/landscaping around the house
- Decorative elements: subtle leaf/plant motifs in corners
- Semi-transparent colored overlay panels for text sections
- Small facility icons (bed, bathroom, carport, kitchen icons) in a clean row

LAYOUT STRUCTURE (top to bottom):
1. Developer/brand name at top
2. Main tagline/headline (large text)
3. Hero house image (center, large)
4. Price & installment info (prominent boxes)
5. Facility icons row
6. Location + contact info at bottom

QUALITY:
- High resolution, print-ready quality
- Professional graphic design quality
- All text must be clearly legible
- ${bahasa === 'indonesia' ? 'All text in Bahasa Indonesia' : 'Mix of Indonesian and English text'}
- No blurry or pixelated elements

Make it look like it was designed by a professional Indonesian graphic designer for property marketing.
    `.trim();

    return prompt;
  },

  // Prompt untuk revisi
  buildRevision(lastPrompt, revisionRequest) {
    return `
Based on this previously generated image, please revise it with the following changes:

REVISION REQUEST: "${revisionRequest}"

Keep everything else the same as before. Maintain the same layout, house image, and overall style.
Only change what was specifically requested.

Original design specifications:
${lastPrompt}
    `.trim();
  },
};

module.exports = PromptService;
