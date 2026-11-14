# eTIMS Sandbox Onboarding — Step-by-Step

This guide walks a new tenant through **KRA eTIMS sandbox** registration and first fiscal invoice. Do this **once per tenant** before switching to production mode. No real tax filings occur in sandbox — it is a technical test environment.

---

## 0. Prerequisites

Before starting, confirm:

- [ ] Tenant has a **KRA PIN** (personal for sole proprietor, non-individual for companies/partnerships/SACCOs)
- [ ] Tenant's **business structure** is decided: `sole_proprietor`, `private_company`, `public_company`, `partnership`, `sacco`, or `cooperative`
- [ ] `ETIMS_CMC_KEY_ENCRYPTION_SECRET` is set on the Render staging and production services (already set — verified in Patch 008D)
- [ ] You are logged into the POS as **admin** (`admin@<tenant>.local`)

---

## 1. Register KRA sandbox account

1. Open **https://etims-sbx.kra.go.ke** (this is the sandbox portal — separate from production)
2. Click **Register** → use the tenant's **KRA PIN**
3. Complete the sandbox onboarding form:
   - Business name, PIN, business structure
   - Contact email + phone
   - Branch information (if multi-branch — start with main branch `00`)
4. Submit. Check the registered email for a **sandbox credentials** confirmation (typically within minutes)
5. Log into the sandbox portal to confirm your PIN is active

**Do not proceed until the sandbox portal shows your PIN is active.**

---

## 2. Configure the tenant in the POS

1. Login to the POS as **admin**
2. Navigate to **`/etims`**
3. Fill in the **Tenant configuration** section:

| Field | Value |
|---|---|
| Business structure | Match the KRA sandbox registration exactly |
| KRA PIN | The exact PIN used at sandbox signup |
| PIN type | `personal` for sole proprietor, `non_individual` for anything else |
| eTIMS mode | **`sandbox`** (do not use `production` yet) |
| eTIMS enabled | ☑ checked |
| VAT registered | ☑ if the tenant is VAT-registered with KRA |
| VAT-inclusive prices | ☑ if menu prices already include VAT |
| PayBill number | Optional — fill if using M-Pesa PayBill (for auto-match in later patch) |
| Fixed account | Optional — fill if you want a fixed M-Pesa account reference |

4. Click **Save config**
5. Verify the page reloads and shows the saved values

---

## 3. Register the POS device with KRA

1. In the **Device registration** section:
   - **Branch ID:** `00` (main branch)
   - **Device serial:** e.g. `POS-NAIROBI-01` — a unique identifier for this POS terminal
2. Click **Register device**
3. Expected response: `{ ok: true, bhf_id: "00", dvc_srl_no: "POS-NAIROBI-01" }`
4. The **Registered devices** panel below shows your new device with:
   - `Last handshake` = today's timestamp
   - `cmcKey` = **`present`** (green badge)

**If the response is a 500** — the `ETIMS_CMC_KEY_ENCRYPTION_SECRET` is not set on Render. Set it and retry.
**If the response is `{ error: "kra_pin_required" }`** — Step 2 didn't save the PIN. Retry Step 2.
**If the response is `{ error: "etims_mode_disabled" }`** — the mode is still `disabled`. Set to `sandbox` in Step 2.

---

## 4. Test invoice — end-to-end

1. Open **`/tables`**
2. Create a test table (e.g. `SANDBOX-TEST`), open a ticket, add one item priced at `KES 100`, VAT `16%`
3. Link a sandbox M-Pesa payment to the ticket (or use `/payments/link-mpesa/<ticketId>` with any sandbox trans ID)
4. Ticket status → **`paid`**
5. Wait **5–15 seconds** for the background worker to process
6. Open **`/etims`** → **Submission queue** panel:
   - Expected: 1 row with status **`success`** and 0 errors
   - If `failed` after 1 attempt → retry grows backoff up to `ETIMS_RETRY_MAX_ATTEMPTS` (default 5)
   - If `permanent_fail` → click **Retry** and inspect the error message
7. Open the paid ticket → the **KRA Fiscal Receipt** panel appears with:
   - **CU-INV** number (e.g. `CU-INV-000001`)
   - Receipt number
   - QR code (scannable — should resolve to KRA's verification page)
   - Signature string
8. Click **Print** — the print preview should show only the fiscal receipt (nothing else)

---

## 5. Verify on KRA sandbox portal

1. Log into **https://etims-sbx.kra.go.ke** as the tenant
2. Navigate to **Invoices** (or **Sales** depending on the portal version)
3. Search for the **CU-INV** number from Step 4 (e.g. `000001`)
4. Confirm the invoice appears with:
   - Match on amount (`KES 116.00` including VAT)
   - Match on item name
   - The exact same `intrl_data` / `rcpt_sign` as in the POS receipt

**This is the moment compliance is proven end-to-end.** If the invoice is missing or the amounts differ, re-check Step 2 (VAT-inclusive flag is the most common cause of amount mismatch).

---

## 6. Common failure modes and fixes

| Error in POS | Meaning | Fix |
|---|---|---|
| `kra_pin_required` | PIN not saved in tenant config | Re-save `/etims` config, ensure PIN field is filled |
| `etims_mode_disabled` | Mode still set to `disabled` | Change to `sandbox` in tenant config |
| `device_init_refuses_mock_mode` | `ETIMS_MOCK_ENABLED=true` on Render | Set to `false` on staging + production |
| `timeout` in queue | KRA sandbox unreachable | Wait — worker retries automatically |
| `kra_reject` in queue | KRA rejected the payload | Admin checks error — likely a tax type or item classification mismatch |
| `invalid_response` in queue | KRA returned partial data | Usually transient — retry |
| `cmcKey missing` badge | Device registered without stored key | Re-register device — the handshake will rewrite the encrypted key |

---

## 7. Promoting to production

**Only after Step 5 confirms the sandbox invoice appears on KRA portal:**

1. Repeat **Steps 1–4** against the **production KRA portal** (`https://etims.kra.go.ke`, not `-sbx`)
2. On `/etims`, change **eTIMS mode** from `sandbox` to **`production`**
3. Re-register the device (production mode requires a fresh handshake — the sandbox `cmcKey` is not valid for production)
4. Repeat Step 4 — the invoice now has real fiscal consequences
5. Verify on the **production** KRA portal

**Important:** production KRA PIN must be the tenant's real registered PIN, not the sandbox one. The two environments have completely separate device registries and invoice sequences.

---

## 8. Support

If anything in this walkthrough fails and the failure isn't covered in the error table above:

- **Render logs:** `https://dashboard.render.com → <service> → Logs` — search for `etims` (worker emits detailed logs including `resultCd` from KRA)
- **Queue detail:** `/etims` → Submission queue table — the `last_error` column has the exact KRA error message
- **Database check (admin only):** the `etims_responses` table has the raw KRA JSON response for every successful submission

The fiscal chain — device → invoice → response → receipt — is designed to be traceable from any single field. If the POS shows `CU-INV-000042`, you can find it in `etims_responses` by `invc_no = 42`.
