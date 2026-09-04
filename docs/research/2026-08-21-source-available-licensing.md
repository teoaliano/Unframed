# Source-available licensing for Unframed — research notes

Researched 2026-08-21. Primary sources only: the actual license texts, the license
stewards' own pages and FAQs, and Unframed's own repo. Every factual line carries the URL
that owns it. Legal reasoning that is *my* inference rather than a quoted source is labelled
as such. This is a research note, not legal advice — see the disclaimer at the end.

## TL;DR

- **Remotion is not under a standard source-available license.** It ships a custom
  **Remotion License**: source is public, anyone may fork, modify, and contribute back, and
  individuals plus for-profits "with up to 3 employees" (and all non-profits) may use it free
  even commercially — but nobody may "copy or modify Remotion code for the purpose of
  selling, renting, licensing, relicensing, or sublicensing your own derivate of Remotion,"
  and 4+-employee companies must buy a Company License to use it in their product
  (<https://www.remotion.pro/license>, raw LICENSE at
  <https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md>).
- **The closest off-the-shelf match to "fork/modify/contribute yes, resell/compete no" is the
  Functional Source License (FSL)** — Sentry's license, one "Competing Use" restriction,
  auto-converts to MIT or Apache 2.0 after two years (<https://fsl.software/>). PolyForm
  Perimeter and a Commons-Clause rider express the same idea without the time-flip.
- **None of these is OSI "open source."** BSL, FSL, PolyForm's restrictive grants, ELv2,
  SSPL and Commons-Clause software are all "source-available," not open source, by the
  stewards' own admission (<https://commonsclause.com/>,
  <https://www.mongodb.com/legal/licensing/server-side-public-license>).
- **Relicensing is legally clean here.** `git log` shows a single author
  (`teoaliano <156580903+teoaliano@users.noreply.github.com>`), matching the sole copyright
  holder in LICENSE, so no contributor consent or CLA is needed to change the license going
  forward.
- **But you cannot claw back what is already MIT.** The MIT grant is perpetual and
  irrevocable for the versions/commits already published (the license text itself grants
  rights "without restriction … to use, copy, modify … and/or sell," with no revocation
  clause — `/Users/matteoaliano/Unframed/LICENSE`). Relicensing binds only future versions;
  every `engine-*` tag already public stays MIT forever.
- **The bigger question is whether you even need to.** The money-making shell
  (`teoaliano/Unframed-app`) is already private; the engine is the public part. A private
  moat may make an engine-license change optional. The trade-off is contributions and
  ecosystem trust vs. blocking a competitor from repackaging the *engine* — decision section
  below.

## 1. How Remotion is actually licensed

Remotion uses a **custom "Remotion License,"** not any standard OSS or source-available
license. It is a two-tier model keyed on legal-entity type and company size.

**What the free license permits.** The grant is worded like MIT's opening but narrowed to
eligible users and to a purpose:

> "Permission is hereby granted, free of charge, to any person eligible for the 'Free
> License', to use the software non-commercially or commercially for the purpose of creating
> videos and images" (<https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md>).

Modification and contribution are explicitly allowed:

> "[To] modify the software to their own liking, for the purpose of fulfilling their custom
> use case or to contribute bug fixes or improvements back to Remotion"
> (<https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md>).

**Who qualifies for the free license.** "An individual; a for-profit organization with up to
3 employees; a non-profit or not-for-profit organization; [an entity] currently evaluating
Remotion for potential commercial use" (<https://www.remotion.pro/license>,
<https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md>). So individuals and
≤3-person for-profits may build videos commercially at no cost.

**What is forbidden.** The one hard prohibition:

> "It is not allowed to copy or modify Remotion code for the purpose of selling, renting,
> licensing, relicensing, or sublicensing your own derivate of Remotion."
> (<https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md>)

This is the "you can fork and contribute, but you can't repackage-and-sell my code" rule
the user described — expressed as a *purpose* restriction on derivatives, layered on top of a
*company-size* restriction on ordinary use.

**What triggers payment.** For-profit companies with **4+ employees** must buy a Company
License (<https://www.remotion.pro/license>). Pricing tiers on that page: Free (individuals
and companies up to 3 people, commercial use included); Company (teams of 4+, "pay according
to usage" — the page shows "Remotion for Automators: $0.01 per render, $100/mo minimum" and
"Remotion for Creators: $25/mo per seat"); Enterprise ("Starting at $500 per month," private
channels, consulting, custom terms) (<https://www.remotion.pro/license>). *Note:* exact
figures are the vendor's current published prices and drift; the structure (free ≤3 →
seat/usage 4+ → enterprise) is the durable part.

## 2. The family of source-available / non-compete licenses

For each: the canonical text, what it permits and forbids, key parameters, and whether it is
OSI open source. **Short answer on OSI for the whole section: none of these is OSI-approved
open source** — they all restrict a field of use (competing/commercial/service), which
violates OSI's Open Source Definition clause 6 ("No Discrimination Against Fields of
Endeavor," <https://opensource.org/osd>). The stewards mostly say so themselves; noted per
license below.

### Business Source License 1.1 (BSL / BUSL) — steward: MariaDB

Canonical text and FAQ: <https://mariadb.com/bsl11/>.

- **Permits (before the Change Date):** "copy, modify, create derivative works, redistribute,
  and make non-production use" of the source (<https://mariadb.com/bsl11/>).
- **Forbids:** production use, *unless* the licensor grants it via the **Additional Use
  Grant** — a free-text field where the licensor "may make an Additional Use Grant … permitting
  limited production use" (<https://mariadb.com/bsl11/>). Everything not in that grant needs a
  commercial license or you "refrain from using the Licensed Work."
- **Change Date + Change License mechanic:** each version flips to an open license on "the
  Change Date, or the fourth anniversary of the first publicly available distribution of a
  specific version" — whichever is earlier, so **4 years is the maximum**. The Change License
  must be "GPL Version 2.0 or any later version, or a license that is compatible with GPL"
  (<https://mariadb.com/bsl11/>).
- **Parameters the licensor fills in:** Additional Use Grant, Change Date, Change License.
- **OSI open source?** No — it is source-available until the flip. **Fit for Unframed's
  goal?** Yes in spirit (blocks competitors' production use, source stays public, eventually
  opens) but it is the "complex" option — fair.io itself calls BUSL "A complex non-compete
  license" and steers new adopters to FSL instead (<https://fair.io/licenses/>).

### Functional Source License (FSL) — steward: Sentry

Canonical text and FAQ: <https://fsl.software/>; license template
`FSL-1.1-MIT` / `FSL-1.1-Apache-2.0`.

- **Permits:** "Right to use, copy, modify, create derivative works, publicly perform,
  publicly display and redistribute the Software for any Permitted Purpose," where Permitted
  Purpose is "Any purpose other than a Competing Use" (FSL-1.1 text). Plainly: "You can run it
  for almost all purposes, study it, modify it, and distribute your changes, including
  proposing improvements back to the producer" (<https://fsl.software/>).
- **Forbids — one restriction only:** **Competing Use**, defined as "Making the Software
  available to others in a commercial product or service that substitutes for the Software or
  offers substantially similar functionality" (FSL-1.1 text). The tagline: do "anything with
  FSL software except undermine its producer" (<https://fsl.software/>).
- **Flip mechanic:** auto-converts, per version, to MIT or Apache 2.0 (you pick the variant)
  "on the second anniversary of the date we make the Software available" — **2 years**, half
  of BSL's max (<https://fsl.software/>, FSL-1.1 text).
- **OSI open source?** No while under FSL; yes after the 2-year flip (that is the point).
- **Why Sentry built it:** to close the gap where "SaaS companies wish to make the source
  code for their core products available under permissive terms without the risk of harmful
  free-riding," standardizing BSL's variability and halving its restriction window
  (<https://fsl.software/>).
- **Fit for Unframed's goal?** **Best off-the-shelf match** — one clean "no competing
  product" rule, forking/modifying/contributing explicitly allowed, delayed open source.

### Fair Source (fair.io) — an umbrella definition, not a license

<https://fair.io/> and <https://fair.io/about/>.

- **Definition (verbatim):** "Fair Source Software (FSS): is publicly available to read;
  allows use, modification, and redistribution with minimal restrictions to protect the
  producer's business model; and undergoes delayed Open Source publication (DOSP)."
  (<https://fair.io/about/>). Three criteria: publicly readable, minimally restricted, and a
  **DOSP** time-flip to open source.
- **Which licenses qualify / are recommended:** the **Functional Source License (FSL)** ("the
  flagship Fair Source license"), the **Fair Core License (FCL)** ("A variant of FSL that
  includes license key support … when monetizing self-hosted software with commercial
  features"), and the **Business Source License (BUSL)** ("A complex non-compete license …
  usually four years") (<https://fair.io/licenses/>).
- **Note the DOSP requirement excludes perpetual restriction:** a license that *never* opens
  (PolyForm Noncommercial, ELv2, SSPL, Commons Clause) is source-available but **not** Fair
  Source, because it never publishes as open source (<https://fair.io/about/>).
- **Fit for Unframed's goal?** Fair Source *is* the "fork/modify/contribute, don't
  free-ride, eventually open" philosophy the user is describing. FSL is its concrete form.

### PolyForm licenses (polyformproject.org)

Steward site: <https://polyformproject.org/>; license list:
<https://polyformproject.org/licenses>. PolyForm makes "simple, standardized, plain-language"
grants filling "gaps … like non-commercial, trial, and small-business-only terms"
(<https://polyformproject.org/>).

- **PolyForm Noncommercial** — use, modify, distribute **for noncommercial purposes only**;
  any commercial use needs a separate license. Forbids all commercial use, so it does *not*
  fit an app the user sells (<https://polyformproject.org/licenses>).
- **PolyForm Shield** — "permits uses other than those that compete with the provider of the
  software"; protects the **licensor's business** broadly
  (<https://polyformproject.org/licenses>).
- **PolyForm Perimeter** — "permits uses other than those that compete with the software";
  protects the **specific product**. It "allows the widest freedom except for uses competing
  directly with the software product" (<https://polyformproject.org/licenses>). This is the
  PolyForm analogue of FSL's competing-use rule, **without** a time-flip.
- **PolyForm Free Trial** — "a free, time-limited trial," i.e. evaluation only
  (<https://polyformproject.org/licenses>).
- (Others: Internal Use — internal business use only; Strict — noncommercial, no distribution
  or modification; Small Business — use by small orgs only.
  <https://polyformproject.org/licenses>.)
- **OSI open source?** No — PolyForm's restrictive grants all discriminate on field of use.
- **Fit for Unframed's goal?** **PolyForm Perimeter** fits "fork/modify/contribute yes,
  compete no" and is arguably the cleanest perpetual (non-flip) statement of it. **Shield**
  is broader (protects the whole business, not just the product). Noncommercial/Strict/Trial
  are too restrictive — they would block the user's *own* commercial shell reasoning and the
  "anyone can use it" goal.

### Elastic License 2.0 (ELv2) — steward: Elastic

Canonical text: <https://www.elastic.co/licensing/elastic-license>.

- **Permits:** a broad grant "to use, copy, distribute, make available, and prepare derivative
  works" (<https://www.elastic.co/licensing/elastic-license>).
- **Forbids — exactly three limitations:** (1) no providing the software "to third parties as
  a hosted or managed service, where the service provides users with access to any substantial
  set of the features or functionality"; (2) no "move, change, disable, or circumvent the
  license key functionality," and no removing/obscuring "any functionality … protected by the
  license key"; (3) no "alter, remove, or obscure any licensing, copyright, or other notices"
  (<https://www.elastic.co/licensing/elastic-license>).
- **OSI open source?** No — the managed-service ban discriminates on field of use.
- **Fit for Unframed's goal?** Partial. ELv2 targets the *SaaS-reseller* threat (limitation 1)
  and DRM circumvention (limitation 2). It does **not** by itself forbid a competitor
  repackaging the code into a *sold desktop product* the way FSL's "competing use" or
  PolyForm Perimeter do. Since Unframed's product is a local app, not a hosted service,
  ELv2's flagship restriction is a weak fit.

### SSPL (Server Side Public License) — steward: MongoDB

Canonical text: <https://www.mongodb.com/legal/licensing/server-side-public-license>.

- **Permits:** running unmodified software, private modifications without disclosure,
  distributing copies with source, modifying and redistributing under SSPL
  (<https://www.mongodb.com/legal/licensing/server-side-public-license>).
- **Forbids / requires:** the **Section 13 service-source-disclosure** obligation — "If you
  make the functionality of the Program … available to third parties as a service, you must
  make the Service Source Code available … at no charge, under the terms of this License,"
  and Service Source Code extends to "all programs that you use to make the Program …
  available as a service, including … management software, user interfaces, APIs, automation
  … monitoring … backup … storage … and hosting software"
  (<https://www.mongodb.com/legal/licensing/server-side-public-license>). It is a copyleft
  poison-pill aimed at cloud providers, not a plain no-compete.
- **Why OSI rejected it:** it "requires disclosure of the **entire service infrastructure**,
  not just modifications," imposing "obligations unrelated to the software itself," which
  OSI considered too restrictive to be open source
  (<https://www.mongodb.com/legal/licensing/server-side-public-license>). (OSI's own account
  is at <https://opensource.org/> / the OSD, <https://opensource.org/osd>.)
- **Fit for Unframed's goal?** Poor. SSPL solves "AWS resells my database as a service." It
  does nothing extra for a locally-installed generator and would saddle honest self-hosters
  with a heavy disclosure burden.

### Commons Clause — a rider, not a standalone license

Canonical text and FAQ: <https://commonsclause.com/>.

- **What it is:** a clause bolted **on top of** an existing license (e.g. MIT or Apache) that
  subtracts one right. Verbatim: "Without limiting other conditions in the License, the grant
  of rights under the License will not include, and the License does not grant to you, the
  right to Sell the Software" (<https://commonsclause.com/>).
- **How "Sell" is defined:** "practicing any or all of the rights granted to you under the
  License to provide to third parties, for a fee or other consideration (including without
  limitation fees for hosting or consulting/support services related to the Software), a
  product or service whose value derives, entirely or substantially, from the functionality of
  the Software" (<https://commonsclause.com/>).
- **OSI open source?** **No, explicitly:** the FAQ says "it is best not to call Commons Clause
  software 'open source'" (<https://commonsclause.com/>).
- **Fit for Unframed's goal?** Reasonable and simple — "MIT, but you can't sell a product
  whose value is substantially the software." It keeps the familiar MIT text, adds one
  sentence, and has **no time-flip**. Downsides: "Sell" is drafted broadly enough to catch
  paid *hosting/consulting*, it is less battle-tested/standardized than FSL, and the
  MIT-that-isn't-MIT framing has drawn community criticism for being confusing.

**One-line comparison for the user's goal ("fork/modify/contribute yes, resell/compete no"):**

| License | Blocks reselling/competing? | Time-flip to OSS? | OSI OSS? | Fit |
| --- | --- | --- | --- | --- |
| Remotion License (custom) | Yes (+ company-size gate) | No | No | The reference model; bespoke |
| FSL | Yes (Competing Use) | Yes, 2 yr → MIT/Apache | No (until flip) | **Strong** |
| BSL 1.1 | Yes (production use) | Yes, ≤4 yr → GPL-compat | No (until flip) | Strong but complex |
| PolyForm Perimeter | Yes (compete w/ product) | No | No | **Strong**, perpetual |
| PolyForm Noncommercial | Blocks all commercial | No | No | Too broad |
| Commons Clause (rider) | Yes (removes "Sell") | No | No | Simple, perpetual |
| ELv2 | Only managed-service resale | No | No | Weak (Unframed isn't SaaS) |
| SSPL | Service-disclosure copyleft | No | No | Poor fit |

## 3. Mechanics and constraints of relicensing an existing MIT project

**Can the copyright holder change the license going forward?** Yes. A copyright owner may
release future versions of their own work under any terms they choose; the license is the
owner's grant, and the owner is free to issue a different grant on new copies. (General
copyright principle; the practical caveat is inbound contributions, below.)

**What happens to code already published under MIT — is it irrevocable?** Yes, for those
versions. Unframed's own LICENSE grants, "without restriction … to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies," with **no revocation or termination
clause** anywhere in the text (`/Users/matteoaliano/Unframed/LICENSE`; canonical MIT text at
<https://opensource.org/license/mit>). *Inference, labelled:* a bare permission grant with no
stated end and no reservation is treated as perpetual and irrevocable for copies already
distributed — you cannot "un-MIT" a commit that shipped. Concretely: anyone may keep using,
forking, and even selling any `engine-*` tag that was public while MIT applied, forever.
Relicensing changes only what happens **from a chosen commit forward**. This is the single
most important legal fact for the decision below.

**Contributor / CLA implications.** When someone else contributes to an MIT project, their
contribution comes *inbound* under MIT (the "inbound=outbound" norm). Relicensing the
combined work to *more restrictive* terms generally needs either every such contributor's
permission or a signed CLA assigning/licensing their rights — you cannot unilaterally
tighten the license on code you do not solely own.

**For Unframed specifically, this is a non-issue today.** Enumerated authors:

```
teoaliano <156580903+teoaliano@users.noreply.github.com>
```

A single author, matching the sole copyright holder in LICENSE
(`Copyright (c) 2026 Matteo Antonio Aliano`). So a relicense is **clean** — no consent, no
CLA needed. *Forward-looking caveat, labelled inference:* the moment a second person's PR is
merged under MIT, that stops being true for later relicensing; if a source-available future
is even possible, adding a lightweight CLA/DCO **before** accepting outside contributions is
far cheaper than chasing consent afterward.

**Practical steps to relicense (future versions only):**
1. Replace `/Users/matteoaliano/Unframed/LICENSE` with the new license text (FSL/PolyForm/etc.
   ship fill-in templates).
2. Update the `"license"` field in `package.json` (currently `"MIT"`) — note SPDX has
   identifiers for some of these (e.g. `Elastic-2.0`, `SSPL-1.0`, `BUSL-1.1`) but **not** for
   FSL or a Commons-Clause combination, so npm's `license` field would need a
   `"SEE LICENSE IN LICENSE"` form for those; a non-OSI license may also trip tooling that
   assumes an SPDX id. (`client/package.json` has no `license` field to change.)
3. Update any per-file headers, the README license section/badge, and `CHANGELOG.md`.
4. Cut the relicense as its own tagged version so the boundary between "last MIT tag" and
   "first new-license tag" is unambiguous — matters because the shell pins engine tags.
5. **npm ecosystem note:** a non-OSI license is legal to publish but changes how the package
   reads to consumers and to license-scanners in downstream corporate pipelines; some CI
   policies auto-reject non-OSI licenses.

## 4. Mapping onto Unframed

The distinctive fact about Unframed: the **commercial product is the private shell**
(`teoaliano/Unframed-app`), which consumes the public engine **by git tag**, one-way
(CLAUDE.md, "The other repo"). So the first question is not *which* source-available license
— it is *whether the engine needs one at all.*

**The private shell may already be the moat.** A competitor can take the MIT engine, but the
engine is "a local, node-based image generator" that calls OpenRouter (CLAUDE.md); the
desktop app, packaging, updater, signing, and commercial surface all live in the private
repo, which they cannot see. If the value a customer pays for is the shell, the engine being
copyable is not obviously a business risk. *Honest counter-point:* a well-funded competitor
could wrap the MIT engine in *their own* shell and sell that — the engine is exactly the
reusable, valuable core, and MIT explicitly permits "sell." Whether that is a real threat
depends on how much of the product's value is the engine vs. the shell, which is a business
judgment, not a licensing fact.

**If you decide the engine itself needs protection**, a source-available engine license
(FSL, PolyForm Perimeter, or a Commons-Clause rider) would let the source stay public and
forkable while forbidding a competitor from repackaging/selling the *engine*. FSL best
matches the user's stated admiration for Remotion: one competing-use restriction,
contribution explicitly allowed, and it eventually opens (2-year flip). PolyForm Perimeter is
the same idea without the flip. Commons Clause is the lightest touch (keep MIT text, subtract
"Sell").

**The costs, stated honestly:**
- **It stops being OSI open source.** That affects (a) *contributions* — legally fine, but
  many contributors won't PR to a non-OSS project, and the "anyone can contribute" goal takes
  a social (not legal) hit; (b) *trust/ecosystem norms* — non-OSI licenses read as
  "commercial-ish" to some users and to corporate license scanners; (c) *npm norms* — see §3
  step 2.
- **Irrevocability limits the upside.** Every `engine-*` tag already public stays MIT (§3).
  A relicense protects only *future* engine work; a competitor could fork the last MIT tag
  and continue from there. The protection is real but not retroactive.
- **Your own shell doesn't need it.** Because the dependency is one-way and you own both
  repos, *your* private shell can consume the engine under whatever terms you set — a
  restrictive engine license does not constrain you. The only thing an engine relicense buys
  is blocking *third parties* from doing what MIT lets them do.

**The shape of the trade-off (decision-oriented, not a recommendation):**
- If the goal is *keep the engine genuinely open and rely on the private shell as the moat* →
  stay MIT; the separation already does the commercial work.
- If the goal is *keep source public and forkable but legally bar a competing product built on
  the engine* → FSL (matches Remotion's philosophy, eventual open) or PolyForm Perimeter
  (perpetual) on the engine, going forward, ideally with a CLA/DCO before outside PRs.
- If the goal is *minimal change, just remove "resell"* → Commons Clause rider on the current
  MIT.
- A full Remotion-style **company-size gate** (free ≤N employees, paid above) is a bespoke
  custom license, not an off-the-shelf template — it is the most business-shaped option and
  the most lawyer-dependent to draft.

**License selection with commercial stakes warrants a lawyer.** The above maps the options to
the stated goal; it is not legal advice. Drafting a custom license, or confirming
enforceability and npm/tooling implications for a specific jurisdiction and business, is a
lawyer's call.

## 5. What the sources do NOT answer

Real gaps in the primary sources consulted, not to be filled from general knowledge:

1. **Jurisdiction-specific enforceability.** None of the license texts or FAQs establishes
   how a "competing use" / "no sell" restriction holds up in any particular country's courts.
   BSL/FSL/PolyForm are relatively new and lightly litigated. A lawyer question.
2. **Whether Unframed's *dependencies* impose license constraints.** Not investigated here:
   the engine is a Node/React monorepo — its own npm dependency tree (React Flow, Express,
   Astryx, etc.) carries licenses that could constrain what Unframed may redistribute under.
   Relicensing Unframed's *own* code does not change what its dependencies require. Needs a
   dependency-license audit (e.g. `license-checker`) that this note did not run.
3. **OpenRouter's terms.** Whether OpenRouter's API terms of service impose any obligation on
   an app that calls it (branding, resale, redistribution) is out of scope of the licensing
   texts read here and is not answered by them.
4. **Tax / commercial-entity questions.** Whether/where to incorporate, how paid licenses are
   taxed, VAT on seat licenses, etc. — entirely outside these sources.
5. **The exact current Remotion price figures.** <https://www.remotion.pro/license> shows
   live pricing that changes; the *structure* (free ≤3 employees, paid 4+) is durable, the
   dollar amounts are a snapshot as of 2026-08-21.
6. **SPDX identifiers and npm tooling behaviour** for FSL and Commons-Clause combinations —
   §3 notes there is no clean SPDX id; the exact downstream tooling fallout was not tested.
7. **Whether a past MIT release could be "revoked."** §3 states the standard understanding
   (irrevocable), but the LICENSE text is silent on revocation rather than affirmatively
   promising perpetuity; the irrevocability conclusion is the settled reading, not a quoted
   clause.

---

*Sources are inline above. Primary references: Remotion License
(<https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md>,
<https://www.remotion.pro/license>); BSL 1.1 (<https://mariadb.com/bsl11/>); FSL
(<https://fsl.software/>); Fair Source (<https://fair.io/about/>,
<https://fair.io/licenses/>); PolyForm (<https://polyformproject.org/>,
<https://polyformproject.org/licenses>); Elastic License 2.0
(<https://www.elastic.co/licensing/elastic-license>); SSPL
(<https://www.mongodb.com/legal/licensing/server-side-public-license>); Commons Clause
(<https://commonsclause.com/>); OSI Open Source Definition (<https://opensource.org/osd>);
Unframed's own LICENSE and package.json.*
