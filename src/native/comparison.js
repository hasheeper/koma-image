function comparisonColumns(total) {
  if (total <= 2) return total;
  if (total === 3) return 3;
  if (total <= 4) return 2;
  if (total <= 9) return 3;
  if (total <= 16) return 4;
  return Math.ceil(Math.sqrt(total));
}

async function drawBlobContained(ctx, blob, x, y, width, height) {
  let source = null;
  let release = () => {};

  if (typeof createImageBitmap === "function") {
    try {
      source = await createImageBitmap(blob);
      release = () => source.close?.();
    } catch {
      source = null;
    }
  }

  if (!source) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try {
      if (image.decode) await image.decode();
      else await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("图片解码失败"));
      });
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
    source = image;
    release = () => URL.revokeObjectURL(url);
  }

  try {
    const scale = Math.min(width / source.width, height / source.height);
    const drawWidth = Math.max(1, Math.round(source.width * scale));
    const drawHeight = Math.max(1, Math.round(source.height * scale));
    const drawX = x + Math.round((width - drawWidth) / 2);
    const drawY = y + Math.round((height - drawHeight) / 2);
    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  } finally {
    release();
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器未能编码对比图"));
    }, "image/png");
  });
}

export async function makeComparison(records, base, signal) {
  const total = records.length;
  const columns = comparisonColumns(total);
  const rows = Math.ceil(total / columns);
  const padding = 24;
  const gap = 12;
  const headerHeight = 76;
  const cellWidth = Math.min(
    480,
    Math.floor((2048 - padding * 2 - gap * (columns - 1)) / columns)
  );
  const cellHeight = Math.max(1, Math.round(cellWidth * base.height / base.width));
  const width = padding * 2 + columns * cellWidth + (columns - 1) * gap;
  const height = padding * 2 + headerHeight + rows * cellHeight + (rows - 1) * gap;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("当前浏览器不支持 Canvas 合成");

  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f2f1f4";
  ctx.font = '600 25px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
  ctx.fillText(`串行批量 · ${total} 张对比`, padding, padding);
  ctx.fillStyle = "#8e8d98";
  ctx.font = '14px ui-monospace, "SFMono-Regular", Menlo, monospace';
  ctx.fillText(
    `${base.modelName || base.model} · ${base.width}×${base.height} · ${base.steps} steps · ${base.sampler}`,
    padding,
    padding + 38,
    width - padding * 2
  );

  for (let index = 0; index < total; index += 1) {
    signal?.throwIfAborted();
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = padding + column * (cellWidth + gap);
    const y = padding + headerHeight + row * (cellHeight + gap);
    ctx.fillStyle = "#16161b";
    ctx.fillRect(x, y, cellWidth, cellHeight);
    await drawBlobContained(ctx, records[index].blob, x, y, cellWidth, cellHeight);

    const labelHeight = Math.min(36, Math.max(28, Math.round(cellHeight * 0.08)));
    ctx.fillStyle = "rgba(7, 7, 9, 0.78)";
    ctx.fillRect(x, y + cellHeight - labelHeight, cellWidth, labelHeight);
    ctx.fillStyle = "#f2f1f4";
    ctx.font = '600 14px ui-monospace, "SFMono-Regular", Menlo, monospace';
    ctx.textBaseline = "middle";
    ctx.fillText(
      `#${index + 1}  ·  seed ${records[index].params.seed}`,
      x + 11,
      y + cellHeight - labelHeight / 2,
      cellWidth - 22
    );
    ctx.textBaseline = "top";
  }

  return { blob: await canvasBlob(canvas), size: { width, height } };
}

