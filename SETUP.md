# Baba Solars — Enquiry Integrations & Diwali Offer: SETUP (Hinglish)

Is guide mein step-by-step bataya gaya hai ki website ka contact form **Google Sheet**, **Admin Email** aur **WhatsApp** se kaise jodna hai, aur **Offers** admin se kaise manage karne hain.

> Kuch bhi set na karo tab bhi website chalegi: enquiry **Admin → Enquiries** mein save hogi aur **WhatsApp (9203900410)** khulega. Sheet + Email ke liye neeche ke steps zaroori hain.

---

## Flow kaise kaam karta hai

Customer "Send enquiry" dabata hai → har step alag `try/catch` mein chalta hai:

1. **Admin → Enquiries** (browser ka IndexedDB — purana flow, ab Type + kW ke saath)
2. **Google Sheet** (Apps Script, action `sheet`)
3. **Admin Email** (Apps Script, action `email`, MailApp se)
4. **WhatsApp** — `https://wa.me/919203900410?text=…` nayi tab mein khulta hai. Popup block ho to **"WhatsApp par bhejein"** button dikhta hai.

* Har enquiry ko ek **submissionId (UUID)** milta hai → Admin, Sheet aur Email mein duplicate nahi banta (double click / retry safe).
* Sheet ya Email fail ho (internet off, galat URL, quota) → wo item **localStorage retry-queue** (`baba-solars:enquiry-retry-queue`) mein rehta hai aur **agle page load** par ya **internet wapas aate hi** dobara bheja jata hai.
* Ek step fail hone se baaki steps par koi asar nahi padta.

---

## Step 1 — Google Sheet banao

1. <https://sheets.google.com> par jao → **Blank spreadsheet**.
2. Naam do, jaise **"Baba Solars Enquiries"**.
3. Header banane ki zaroorat nahi — script khud **"Enquiries"** tab aur ye header row bana dega:

   `Submission ID | Date & Time | Name | Mobile | Email | Enquiry Type | Required kW | Message`

## Step 2 — Apps Script paste karo

1. Usi Sheet mein menu: **Extensions → Apps Script**.
2. Left side `Code.gs` kholo, uska saara code delete karo.
3. Project ki file **`apps-script/Code.js`** ka poora content copy karke yahan paste karo → **Save** (Ctrl+S).
4. (Optional) Left mein **Project Settings (⚙️)** → "Show appsscript.json manifest file" ON karke `apps-script/appsscript.json` ka content bhi paste kar sakte ho (timezone Asia/Kolkata set ho jayega).

## Step 3 — Script Properties set karo (Admin email + Token)

**Project Settings (⚙️) → Script Properties → Add script property**:

| Property | Value | Zaroori? |
|---|---|---|
| `API_TOKEN` | Ek lamba random string, jaise `bs-7Kq9…` (32+ characters). Yahi value `.env` mein `VITE_APPS_SCRIPT_TOKEN` mein jayegi. | **Haan** |
| `ADMIN_EMAIL` | Notification kis email par aaye, jaise `babasolars76@gmail.com`. Ek se zyada ho to comma se: `a@x.com,b@y.com` | Email ke liye haan |
| `SHEET_ID` | Sirf tab jab script Sheet se bound **nahi** hai (Sheet URL mein `/d/<YEH_ID>/edit`) | Nahi |
| `SHEET_NAME` | Tab ka naam (default `Enquiries`) | Nahi |

> Admin email **sirf Apps Script** mein hai — website ke code/bundle mein kahin nahi.

Random token banane ka tareeka (terminal): `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

## Step 4 — Pehli baar permission do

1. Apps Script editor mein upar function dropdown se **`setup`** chuno → **Run**.
2. Google permission maangega → apna account chuno → "Advanced" → "Go to … (unsafe)" → **Allow** (ye aapki apni script hai).
3. Sheet mein **"Enquiries"** tab header ke saath ban jayega (aur ek hidden **"EmailLog"** tab — isse ek enquiry ka email ek hi baar jata hai).
4. Email template check karna ho to **`sendTestEmail`** run karo → `ADMIN_EMAIL` par sample email aayega.

## Step 5 — Web App deploy karo ("Anyone" access)

1. Upar right **Deploy → New deployment**.
2. ⚙️ (Select type) → **Web app**.
3. Settings:
   * **Description**: `Baba Solars enquiries v1`
   * **Execute as**: **Me** (aapka account)
   * **Who has access**: **Anyone**  ← zaroori, warna website request nahi bhej payegi
4. **Deploy** → jo **Web app URL** mile (`https://script.google.com/macros/s/……/exec`) usse copy karo.
5. Check: wo URL browser mein kholo → `{"ok":true,"service":"Baba Solars enquiries",…}` dikhna chahiye.

> **Code badalne ke baad:** Deploy → **Manage deployments** → ✏️ Edit → Version: **New version** → Deploy. (URL wahi rehta hai.) Sirf Save karne se live Web App update nahi hota.

## Step 6 — URL aur Token `.env` mein daalo

Project folder mein `.env.example` ko copy karke **`.env`** banao:

```bash
cp .env.example .env
```

`.env` mein:

```env
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXXXXXXXXXX/exec
VITE_APPS_SCRIPT_TOKEN=wahi-value-jo-API_TOKEN-mein-daali
# Optional (default 919203900410):
# VITE_ENQUIRY_WHATSAPP=919203900410
```

* `.env` file `.gitignore` mein hai — Git mein commit nahi hogi.
* URL/Token source code mein hardcoded nahi hain; build ke time `.env` se aate hain.
* ⚠️ `VITE_*` values build hone ke baad public JavaScript mein dikh sakti hain. Token casual misuse rokta hai, password nahi hai. Kabhi misuse dikhe to `API_TOKEN` + `.env` dono badal kar redeploy karo.
* Vercel / Netlify par deploy karte ho to yahi 2 variables unke **Environment Variables** settings mein daalo, phir redeploy.

## Step 7 — Build & deploy

```bash
npm install
npm run dev            # local test: http://localhost:5173/contact
npm run build          # production build → dist/
npm run build:ssg      # (SEO ke liye best) build + prerendered pages
npm run preview        # dist/ ko local serve karke check karo
```

`dist/` folder ko apne hosting (Vercel / Netlify / Cloudflare Pages / cPanel) par upload karo — `vercel.json` aur `public/_redirects` pehle se ready hain.

### Live check (2 minute)
1. Website → **Contact** → form bharo (sirf mobile) → submit.
2. Sheet mein nayi row aayi? `ADMIN_EMAIL` par email aaya? WhatsApp khula?
3. Admin (`/admin`) → **Enquiries** → nayi enquiry **Type** aur **kW** columns ke saath dikh rahi hai?
4. Same browser mein enquiry dobara bhejne (double click) par Sheet mein ek hi row bani?

---

## Offers (Diwali offer) — Admin se manage karo

**Admin → Website → Offers** (`/admin/offers`):

* **Add offer** — badge, title, description, kW slabs + gifts, **posters** (Upload, upar/neeche order, kisi kW slab ke saath jodo), **Starts on / Ends on** dates, terms line, booking amount (₹), lucky draw text, button text.
* **Edit** (blue ✏️), **Delete** (red 🗑️), **Show on site** switch se Enable/Disable. Status badge: Live / Scheduled / Ended / Disabled.
* Default offer = **Diwali Dhamaka Offer, 1–25 Nov 2026** (official posters ke hisaab se): 3 kW: 32-inch Smart TV + Speaker OR RO + Induction Cooktop · 5 kW: Electric Scooty OR Washing Machine + Refrigerator · 10 kW: iPhone free · Lucky draw: Mahindra BE 6 · Booking ₹2,000. Saath mein 5 posters.
* End date ke baad offer website se **apne aap hat jata hai**; start date se pehle nahi dikhta.
* Saare offers delete kar diye to empty screen par **"Add the Diwali offer"** button se wapas laa sakte ho.
* Website par: home page ka **sabse pehla section** (poster slider + gift cards + "Book now" button), **/offers** page (saare posters, Download button), har page par upar offer patti (marquee), aur header mein gold **"Offers"** button.
* Sirf offer wale components Diwali theme mein hain — baaki website ka design waisa hi hai.
* Offers wahi storage use karte hain jo baaki "Site content" (IndexedDB) — Backup & restore mein bhi include hain.

> Yaad rahe (purani limitation): ye project frontend-only hai — admin mein kiye changes **usi browser** mein dikhte hain jahan edit kiye. Isliye Google Sheet + Email integration important hai: har device se aayi enquiry Sheet/Email mein pahunchti hai.

---

## Problem aaye to

| Problem | Kya check karein |
|---|---|
| Sheet mein row nahi aa rahi | Web App access **Anyone** hai? `.env` URL `/exec` par khatam hota hai? Code change ke baad **New version** deploy kiya? `.env` badalne ke baad **dobara build** kiya? |
| Response `Unauthorized` | `API_TOKEN` (Script Property) aur `VITE_APPS_SCRIPT_TOKEN` exactly same hon (space na ho). |
| Email nahi aa raha, Sheet theek | `ADMIN_EMAIL` property set hai? Spam folder dekho. Gmail free account ki limit ~100 emails/din — fail hua email retry-queue se baad mein chala jayega. |
| Retry-queue dekhni hai | Browser DevTools → Application → Local Storage → `baba-solars:enquiry-retry-queue`. |
| WhatsApp nahi khula | Browser ne popup block kiya — success screen par **"WhatsApp par bhejein"** button dabao. |

## Tests

```bash
npm run typecheck && npm test        # unit tests (form rules, flow, retry queue, Apps Script, offers)
npm run build && npm run preview     # phir doosre terminal mein:
npm run test:e2e:enquiry             # browser test (Apps Script fake hota hai; build VITE_APPS_SCRIPT_URL + TOKEN ke saath karo — file ke upar dekho)
```
