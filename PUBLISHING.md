# Publishing Tabshelf to the Chrome Web Store

Everything you need to upload is in this folder:

| What | File |
|---|---|
| Extension package to upload | `releases/tabshelf-v2.2.0.zip` |
| Store icon (128×128) | `store-listing/icon-128.png` |
| Screenshots (1280×800) | `store-listing/screenshot-1-board.png` … `screenshot-5-dark-menu.png` |
| Small promo tile (440×280) | `store-listing/promo-small-440x280.png` |
| Marquee promo tile (1400×560, optional) | `store-listing/promo-marquee-1400x560.png` |
| Listing text, permission justifications, privacy answers | `store-listing/STORE_LISTING.md` |
| Privacy policy to host | `PRIVACY.md` |

## Before you start: keep it your own product
The Chrome Web Store rejects listings that copy another product's name, logo, screenshots or wording, or that present
themselves as another product. Tabshelf has its own name, icon, text and screenshots, so keep it that way:
don't mention any other product in the name, description or keywords, and don't upload their images.
Matching features is fine; matching branding is not.

## 1. Create your developer account (one time)
1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and sign in with the
   Google account you want to publish under. Google requires 2-Step Verification on that account.
2. Accept the developer agreement and pay the one-time registration fee (it has been US $5; the page shows the current amount).
3. In **Account**, set your publisher display name and a contact email, and verify the email.
4. Complete the **trader / non-trader** declaration. If you're publishing a free hobby project, "non-trader" usually applies.

## 2. Host the privacy policy
The store needs a public URL for a privacy policy, because Tabshelf uses the `tabs` permission.
1. Open `PRIVACY.md`, replace `[your email address]` with your contact email.
2. Publish it somewhere public. The quickest options are a public GitHub Gist, a GitHub Pages site, a Google Doc
   shared "Anyone with the link can view", or a free Google Sites page.
3. Copy the URL; you'll paste it in step 5.

## 3. Upload the package
1. In the dashboard, click **New item** (or **Add new item**).
2. Upload `releases/tabshelf-v2.2.0.zip`. (`manifest.json` must be at the root of the zip, which it is.)

## 4. Store listing tab
1. **Description:** paste the detailed description from `STORE_LISTING.md`. The short summary comes from the manifest.
2. **Category:** Productivity → Tools, or Workflow & Planning.
3. **Language:** English.
4. **Graphic assets:** upload the 128×128 icon, the five 1280×800 screenshots (in order), the 440×280 small promo tile,
   and optionally the 1400×560 marquee.
5. **Additional fields (optional):** homepage URL (your GitHub repo or Gist), support URL or email.

## 5. Privacy practices tab
Copy each answer from the matching section of `STORE_LISTING.md`:
1. **Single purpose description.**
2. **Permission justification** for each permission listed (storage, unlimitedStorage, tabs, tabGroups, favicon,
   contextMenus, topSites, search, alarms, notifications, and the optional bookmarks permission).
3. **Are you using remote code?** No.
4. **Data usage:** tick "Website content" and "Web history" (because the extension reads tab titles and addresses to save them),
   then tick all three certifications (not sold, not used for unrelated purposes, not used for creditworthiness).
5. **Privacy policy URL:** paste the URL from step 2.

## 6. Distribution tab
1. **Payments:** free.
2. **Visibility:** Public (anyone can find it), Unlisted (only people with the link), or Private (only testers you name).
   Unlisted is a good first step if you just want to install it on your own machines without Developer mode.
3. **Regions:** all regions.

## 7. Submit
1. Click **Submit for review**. You can choose to publish automatically once approved, or to publish manually afterwards.
2. Review usually takes from a few days to a couple of weeks. Extensions that use the `tabs` permission can take longer.
   You'll get an email when it's approved or if anything needs changing.
3. If it's rejected, the email names the policy. The most common reasons are a mismatch between the privacy answers and
   what the code does, missing permission justifications, or branding that resembles another product.

## Publishing updates later
1. Raise `"version"` in `manifest.json` (for example `2.0.1`).
2. Zip the extension folder's contents again (`manifest.json` at the root).
3. In the dashboard, open Tabshelf → **Package** → **Upload new package**, then **Submit for review**.
Users get the update automatically after it's approved, and their data is kept.

## Switching from your unpacked copy to the store version
The store version gets a different extension ID, so it starts with an empty board. Before removing the unpacked copy,
open *Settings → Export backup*. Then install from the store and use *Settings → Restore backup*.
