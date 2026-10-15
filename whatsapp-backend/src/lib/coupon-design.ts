// Thar ROXX giveaway coupon artwork (1200 x 630 SVG). The same file is used by the dashboard
// (preview / download) and the WhatsApp backend (PNG sent after payment): keep
// src/lib/coupon-design.ts and whatsapp-backend/src/lib/coupon-design.ts identical.

export type CouponArt = {
  code: string;
  customerName?: string | null | undefined;
  orderNumber?: string | null | undefined;
  issuedAt?: string | null | undefined;
  storeName?: string | null | undefined;
  // Photo of the Thar ROXX (data: URI or URL). Without one, a drawn SUV is used.
  imageHref?: string | null | undefined;
};

export const COUPON_WIDTH = 1200;
export const COUPON_HEIGHT = 630;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// Boxy off-roader in the Thar style (upright body, flat roof, flared arches, rear spare wheel),
// used until a real photo is uploaded
const SUV_ART = `
  <g transform="translate(60 190)">
    <ellipse cx="275" cy="292" rx="265" ry="16" fill="#000" opacity="0.35"/>
    <circle cx="34" cy="150" r="40" fill="#111827"/><circle cx="34" cy="150" r="18" fill="#6b7280"/>
    <path d="M52 230 L52 52 Q52 30 74 30 L370 30 Q384 30 388 44 L410 124 L506 132 Q528 134 528 156 L528 230 Z" fill="#f97316"/>
    <rect x="52" y="190" width="476" height="40" fill="#c2410c"/>
    <rect x="44" y="20" width="336" height="12" rx="5" fill="#1f2937"/>
    <rect x="76" y="48" width="118" height="70" rx="6" fill="#0f172a" opacity="0.88"/>
    <rect x="206" y="48" width="120" height="70" rx="6" fill="#0f172a" opacity="0.88"/>
    <path d="M338 48 L368 48 L392 118 L338 118 Z" fill="#0f172a" opacity="0.88"/>
    <rect x="200" y="132" width="4" height="58" fill="#9a3412"/><rect x="332" y="132" width="4" height="58" fill="#9a3412"/>
    <rect x="300" y="140" width="24" height="6" rx="3" fill="#7c2d12"/>
    <circle cx="512" cy="152" r="11" fill="#fde68a"/>
    <rect x="510" y="214" width="34" height="18" rx="4" fill="#1f2937"/>
    <path d="M70 230 Q70 170 140 170 Q210 170 210 230 Z" fill="#1f2937"/>
    <path d="M360 230 Q360 170 430 170 Q500 170 500 230 Z" fill="#1f2937"/>
    <g fill="#111827"><circle cx="140" cy="240" r="54"/><circle cx="430" cy="240" r="54"/></g>
    <g fill="#9ca3af"><circle cx="140" cy="240" r="27"/><circle cx="430" cy="240" r="27"/></g>
    <g fill="#e5e7eb"><circle cx="140" cy="240" r="10"/><circle cx="430" cy="240" r="10"/></g>
  </g>`;

export function couponSvg(c: CouponArt) {
  const store = esc(clip(c.storeName || "ibird", 20));
  const code = esc(c.code);
  const name = c.customerName ? esc(clip(c.customerName, 26)) : "";
  const order = c.orderNumber ? esc(c.orderNumber) : "";
  const date = c.issuedAt
    ? esc(new Date(c.issuedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }))
    : "";
  const font = "Poppins, 'Segoe UI', Arial, sans-serif";

  const art = c.imageHref
    ? `<image href="${esc(c.imageHref)}" x="0" y="0" width="660" height="630" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)"/>
       <rect x="0" y="0" width="660" height="630" fill="url(#photoShade)" clip-path="url(#photo)"/>`
    : `<rect x="0" y="0" width="660" height="630" fill="url(#sky)" clip-path="url(#photo)"/>
       <g clip-path="url(#photo)">
         <circle cx="520" cy="150" r="70" fill="#fbbf24" opacity="0.9"/>
         <path d="M0 470 L120 380 L230 440 L360 330 L500 430 L660 360 L660 630 L0 630 Z" fill="#1e293b"/>
         <path d="M0 540 L660 500 L660 630 L0 630 Z" fill="#7c2d12" opacity="0.55"/>
         ${SUV_ART}
       </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COUPON_WIDTH}" height="${COUPON_HEIGHT}" viewBox="0 0 ${COUPON_WIDTH} ${COUPON_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e1b4b"/>
    </linearGradient>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fb923c"/><stop offset="0.55" stop-color="#be123c"/><stop offset="1" stop-color="#312e81"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fde68a"/><stop offset="0.5" stop-color="#fbbf24"/><stop offset="1" stop-color="#f97316"/>
    </linearGradient>
    <linearGradient id="photoShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.55" stop-color="#0b1220" stop-opacity="0"/><stop offset="1" stop-color="#0b1220" stop-opacity="0.85"/>
    </linearGradient>
    <clipPath id="photo"><rect x="0" y="0" width="660" height="630"/></clipPath>
  </defs>

  <rect width="${COUPON_WIDTH}" height="${COUPON_HEIGHT}" fill="#ffffff"/>
  <rect width="${COUPON_WIDTH}" height="${COUPON_HEIGHT}" rx="28" fill="url(#bg)"/>
  ${art}

  <!-- ticket perforation -->
  <line x1="660" y1="40" x2="660" y2="590" stroke="#fbbf24" stroke-width="3" stroke-dasharray="10 12" opacity="0.7"/>
  <circle cx="660" cy="0" r="26" fill="#ffffff"/><circle cx="660" cy="630" r="26" fill="#ffffff"/>

  <g font-family="${font}">
    <text x="700" y="92" font-size="22" font-weight="700" letter-spacing="6" fill="#fbbf24">MEGA GIVEAWAY</text>
    <text x="700" y="150" font-size="40" font-weight="600" fill="#e5e7eb">Win a</text>
    <text x="700" y="225" font-size="78" font-weight="800" fill="url(#gold)">THAR ROXX</text>

    <text x="700" y="292" font-size="20" font-weight="500" fill="#94a3b8" letter-spacing="2">YOUR LUCKY COUPON CODE</text>
    <rect x="700" y="310" width="460" height="96" rx="16" fill="#fbbf24" fill-opacity="0.12" stroke="#fbbf24" stroke-width="3" stroke-dasharray="14 10"/>
    <text x="930" y="374" font-size="50" font-weight="800" fill="#ffffff" text-anchor="middle" letter-spacing="4">${code}</text>

    ${name ? `<text x="700" y="456" font-size="24" font-weight="600" fill="#f8fafc">${name}</text>` : ""}
    ${order || date ? `<text x="700" y="490" font-size="19" fill="#94a3b8">${[order && `Order ${order}`, date].filter(Boolean).join("  ·  ")}</text>` : ""}

    <text x="1160" y="92" font-size="26" font-weight="800" fill="#ffffff" text-anchor="end">${store}</text>
    <text x="700" y="566" font-size="17" fill="#94a3b8">Keep this coupon safe. One entry per paid order.</text>
  </g>
</svg>`;
}
