/* 用 Canvas 画原尺寸卡片：同一个画布既是实时预览，也是最终保存的 PNG/JPG。 */
const QuoteCardRenderer = (() => {
  'use strict';
  const C = QuoteCardLayout;
  function rounded(ctx, x, y, w, h, radius) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
  }
  function coverImage(ctx, image, x, y, w, h) {
    const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
    const sw = w / scale, sh = h / scale;
    ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  }
  function grain(ctx, width, height, color) {
    // 固定种子的纸纹，预览、下载与重新打开都一致；不依赖外部素材。
    ctx.save(); ctx.fillStyle = color; ctx.globalAlpha = 0.05;
    let seed = 1729;
    for (let index = 0; index < Math.min(26000, width * height / 95); index++) {
      seed = (seed * 16807) % 2147483647; const x = seed % width;
      seed = (seed * 16807) % 2147483647; const y = seed % height;
      ctx.fillRect(x, y, 1 + seed % 2, 1);
    }
    ctx.restore();
  }
  function mountains(ctx, x, y, w, h, night = false) {
    const gradient = ctx.createLinearGradient(x, y, x, y + h);
    gradient.addColorStop(0, night ? '#344a63' : '#c8d7d2'); gradient.addColorStop(1, night ? '#14243b' : '#647e76');
    ctx.fillStyle = gradient; ctx.fillRect(x, y, w, h);
    for (let layer = 0; layer < 5; layer++) {
      const base = y + h * (0.37 + layer * 0.14);
      ctx.beginPath(); ctx.moveTo(x, y + h);
      for (let i = 0; i <= 60; i++) {
        const xx = i / 60;
        const yy = base - (Math.sin(xx * 8.6 + layer * 1.1) * 0.12 + Math.sin(xx * 19.3 + layer) * 0.04) * h;
        ctx.lineTo(x + xx * w, yy);
      }
      ctx.lineTo(x + w, y + h); ctx.closePath();
      ctx.fillStyle = night ? ['#52657a', '#3e536b', '#30465b', '#233d50', '#1c3347'][layer] : ['#adbfb8', '#8fa69d', '#718e81', '#4c6c5f', '#2f5045'][layer];
      ctx.fill();
    }
    // 下层小树提供近景，山线使用柔和轮廓而不抢占摘句的位置。
    ctx.fillStyle = night ? '#142735' : '#294b40';
    for (let i = 0; i < 28; i++) {
      const tx = x + (i + 0.4) * w / 28, th = h * (0.04 + (i * 13 % 11) / 110);
      ctx.beginPath(); ctx.moveTo(tx, y + h - th); ctx.lineTo(tx - th / 4, y + h); ctx.lineTo(tx + th / 4, y + h); ctx.closePath(); ctx.fill();
    }
  }
  function flowers(ctx, width, height, color) {
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.3;
    for (const [x, y, r] of [[width - 97, 148, 15], [width - 143, 220, 10], [94, height - 122, 13], [140, height - 80, 9]]) {
      ctx.beginPath(); ctx.moveTo(x - 30, y + 58); ctx.quadraticCurveTo(x + 8, y + 32, x, y); ctx.stroke();
      for (let p = 0; p < 5; p++) {
        const angle = p * Math.PI * 2 / 5;
        ctx.beginPath(); ctx.ellipse(x + Math.cos(angle) * r * .65, y + Math.sin(angle) * r * .65, r * .7, r * .4, angle, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  function paint(canvas, rawSettings, content, image = null, masking = null, maskImages = null) {
    const s = C.normalize(rawSettings);
    const missingMaskImages = new Set();
    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');
    const family = C.fonts[s.font];
    const layout = C.layout(s, content, (value, size, bold, italic = false) => {
      measureContext.font = `${italic ? 'italic ' : ''}${bold ? '600 ' : ''}${size}px ${family}`;
      return measureContext.measureText(value).width;
    }, masking);
    // 一张长图使用稳定上限；超长时降低输出比例，保留所有文字而不拆图。
    const requestedScale = s.width / 1080;
    const scale = Math.min(requestedScale, 30000 / layout.height, Math.sqrt(26000000 / (1080 * layout.height)));
    if (scale < 0.32) throw new Error('这段内容超出了浏览器单张图片的尺寸，请减少摘句或调小字号后再保存。');
    canvas.width = Math.round(1080 * scale); canvas.height = Math.ceil(layout.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器暂时无法绘制图片，请重新打开页面。');
    ctx.scale(scale, scale);
    ctx.fillStyle = s.background; ctx.fillRect(0, 0, 1080, layout.height);
    ctx.save(); rounded(ctx, 0, 0, 1080, layout.height, s.radius); ctx.clip();
    if (s.imageMode === 'full' && image) {
      ctx.save(); ctx.globalAlpha = s.imageOpacity / 100;
      coverImage(ctx, image, 0, 0, 1080, layout.height); ctx.restore();
    }
    if (s.template === 'paper') {
      grain(ctx, 1080, layout.height, '#674e2d');
      ctx.save(); ctx.strokeStyle = s.accent; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
      ctx.strokeRect(30, 30, 1020, layout.height - 60); ctx.restore();
    }
    if (s.template === 'sakura') { grain(ctx, 1080, layout.height, '#a76c7f'); flowers(ctx, 1080, layout.height, s.accent); }
    if (s.template === 'night' && !image) {
      const glow = ctx.createRadialGradient(900, 160, 10, 900, 160, 750);
      glow.addColorStop(0, '#b9cfed22'); glow.addColorStop(1, '#b9cfed00'); ctx.fillStyle = glow; ctx.fillRect(0, 0, 1080, layout.height);
      ctx.save(); ctx.fillStyle = s.accent; ctx.globalAlpha = 0.4;
      for (let i = 0; i < 30; i++) { ctx.beginPath(); ctx.arc(90 + i * 173 % 900, 70 + i * 97 % 700, i % 3 ? 1.2 : 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (s.imageMode === 'top') {
      const margin = 42, width = 1080 - margin * 2;
      ctx.save(); rounded(ctx, margin, margin, width, s.coverHeight, Math.max(0, s.radius - 10)); ctx.clip();
      if (image) coverImage(ctx, image, margin, margin, width, s.coverHeight);
      else mountains(ctx, margin, margin, width, s.coverHeight, s.template === 'night');
      ctx.restore();
      // 封面右下角只做装饰，不附加品牌、二维码或手机状态栏。
      ctx.save(); ctx.strokeStyle = '#ffffff9a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(1080 - 91, s.coverHeight - 5, 21, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(1080 - 91, s.coverHeight - 5, 6, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    const xFor = align => align === 'center' ? 540 : align === 'right' ? 1080 - s.padding : s.padding;
    ctx.textBaseline = 'top';
    function drawLine(line, y, size, align, color) {
      let x = align === 'center' ? 540 - line.width / 2 : align === 'right' ? 1080 - s.padding - line.width : s.padding;
      ctx.textAlign = 'left';
      for (const run of line.runs) {
        if (run.mask && !['text', 'pattern'].includes(run.mask.kind)) {
          // 不同规则可以使用不同图片；仍兼容旧调用传入单张 Image 的方式。
          const maskImage = typeof maskImages?.get === 'function' ? maskImages.get(run.mask.style.image) : maskImages;
          if (run.mask.kind === 'image' && !maskImage) missingMaskImages.add(run.mask.style.image);
          QuoteCardMosaic.draw(ctx, run.mask, x, y, run.width, size, maskImage);
        } else {
          // 图形遮挡不会经过 fillText；替换字/图案在排版前已替掉原文。
          ctx.font = `${run.thought ? 'italic ' : ''}${size}px ${family}`;
          ctx.fillStyle = run.mask ? run.mask.style.color : run.thought ? s.thoughtColor : color;
          ctx.fillText(run.text, x, y);
        }
        x += run.width;
      }
    }
    if (layout.heading.length) {
      for (let i = 0; i < layout.headingRuns.length; i++) drawLine(layout.headingRuns[i], layout.titleY + i * 37, 24, s.align, s.accent);
    }
    if (s.template !== 'cover') {
      ctx.save(); ctx.fillStyle = s.accent; ctx.globalAlpha = 0.55;
      ctx.font = '96px Georgia, serif'; ctx.textAlign = s.align;
      ctx.fillText('“', xFor(s.align), layout.textTop - 74); ctx.restore();
    }
    // 每行按整行宽度对齐，再分别画正文和独白；测量时已使用相同斜体字体。
    ctx.textAlign = 'left';
    for (let i = 0; i < layout.bodyRuns.length; i++) {
      drawLine(layout.bodyRuns[i], layout.textTop + i * s.fontSize * s.lineHeight, s.fontSize, s.align, s.textColor);
    }
    let y = layout.textTop + layout.quoteHeight + 38;
    if (layout.signature.length) {
      for (const line of layout.signatureRuns) { drawLine(line, y, 24, 'right', s.accent); y += 40; }
    }
    ctx.font = `18px ${family}`; ctx.fillStyle = s.accent; ctx.textAlign = 'right';
    if (s.showDate) { ctx.fillText(content.date || new Date().toLocaleDateString('zh-CN'), 1080 - s.padding, y + 12); y += 40; }
    if (s.showMark) { ctx.textAlign = 'left'; ctx.fillText('AionsHome · 摘句', s.padding, layout.height - s.padding + 8); }
    ctx.restore();
    return { width: canvas.width, height: canvas.height, logicalHeight: layout.height, lines: layout.body.length, reduced: scale < requestedScale - 0.001, maskCount: layout.maskCount, maskCounts: layout.maskCounts, safeTitle: layout.safeTitle, missingMaskImages: [...missingMaskImages] };
  }
  return { paint };
})();
