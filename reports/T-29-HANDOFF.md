# T-29 HANDOFF — protokolliraport (lõplik)

- Pilet: T-29 (P1). Omanik: saipen. Faas: DONE. Sündmus: E-296.
- Ahel: VERIFY → REVIEW → SHIP → DONE ehtsate käskudega.
- Eelmiste sessioonide blokeerijad lahendatud, tõendid žurnaalitud.

## Elutsükkel (kontrollitav)

- E-283: T-29 VERIFY-s (pärandseisund).
- Tõendivärav vajas `PASS` + `conf: high` pärast VERIFY-piiri — kanoniline
  käsk töötab; `>`-müüti ei esine (värav loeb kujundit, mitte noolt).
- Katse-värav (attempt.py): iga `candidate`-sulgemise järel on vaja uut
  VERIFY-piiri. Tehtud: A-002 suletud → SHIP→BUILD→VERIFY →
  tõend-checkpoint → REVIEW → SHIP → `ticket done own_patch` (FINISHED).
- Sündmusi fabritseeritud ei ole; faas DONE, ülesanne none.

## Inseneritöö (kõik etapid)

- A: T-29 ühildatud, duplikaati ei loodud.
- B: `verifyPackageHandoff()` — 5 olekut, ainult FULL_READY annab
  kontrollitud väited (14 negatiivkontrolli).
- C: `normalizeTarget()` kasutab `normalizeOrigin()`-it (volitused,
  päring, fragment, port, tee keelatud).
- D: `verifyReleaseHandoff()` + CI-samm (factory == package == target).
- E: exit 4 ATTESTATION_GAP + OPERATOR.md (3 + 3 testi).
- F: uus pakett + genereeritud checklist (vt all).
- G: täielik kohalik verifitseerimine (vt numbrid).

## Lõplik artefakt (saipenprotocol.com)

- Generatsioon: g-de5f0b085c6064f6 (134 faili, leping 2).
- Kandidaat SHA-256: de5f0b085c6064f6…b1ae6ac.
- Pakett: …-de5f0b085c60.zip, SHA-256 50a5d693…421d25db, 2752470 baiti.
- Olek: FULL_READY_FOR_OPERATOR_HANDOFF (baitidelt ümber kontrollitud).
- Tagasipöördumine: eelmine generatsioon + riiuli-ZIP-id alles.

## Testid (tegelikud jooksutamised)

- Fookus: 275/275 (skip/browser/attestation/provenance/checklist/transaction/candidate/hardening/doctor/origin).
- Hardening eraldi: 36/36. Engine agregaat: 289/289.
- Brauser: maatriks 535 pass + 80 volitatud skip (Chromium+WebKit),
  candidate-host 3/3, dual-origin PASS.
- Tehas --profile=full: PASS, exit 0 (atesteeritud, mitte GAP-4).

## Välised blokeerijad (operaator)

- Ajutine hostinimi valimata → ajutise domeeni ZIP-i ei eksisteeri.
- Hosting, DNS/TLS, 404-käitumine, redirectid, indekseerimine: EXTERNAL_UNVERIFIED.
- Avaldamisvolitus puudub. ET/RU keelatud. Midagi avaldatud ei ole.

## Järgmine tegevus

- NONE inseneripoolel. Operaator: vali ajutine hostinimi → uus build +
  pakett + checklist sellele nimele.
