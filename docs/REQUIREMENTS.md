# Requirements

Vendor-neutral statement of what this system does and what it must guarantee.
Brands, storefront platforms and review platforms are referred to by role rather
than by name, because adding the fourth of any of them must be a configuration
change and not a rewrite.

---

## 1. Purpose

Public storefronts publish their catalogue and their customer reviews, and then
quietly change both. A price moves, a colourway sells out, a model is retired, a
complaint appears. None of that is retained anywhere a competitor, an analyst or
the brand itself can query later: the storefront shows only *now*.

This system observes a set of storefronts on a schedule, reconstructs the
product hierarchy behind their flat product listings, and records what it saw
each time, so that questions about **change over time** become range scans
rather than archaeology.

### 1.1 Questions the system exists to answer

1. What does this brand actually sell right now, organised by line, generation,
   thickness and colourway rather than as an undifferentiated list?
2. How has the price of a given item moved, and when did it go on discount?
3. What went out of stock, what came back, and what disappeared entirely?
4. What are customers saying, and is sentiment for a product improving or
   deteriorating month over month?
5. How do two brands compare on any of the above, on the same axes?

---

## 2. Scope

### 2.1 In scope

- Read-only collection from **publicly accessible** storefront and review
  endpoints.
- Normalisation of raw listings into a queryable product hierarchy.
- Time-series retention of price, discount, stock and review aggregates.
- A read-only dashboard over the collected data.
- Scheduled unattended collection.

### 2.2 Out of scope

- Any authenticated, paywalled or personal data.
- Purchasing, cart interaction, or any write to an observed storefront.
- Real-time collection. The system is a periodic observer, not a live feed.
- Reseller, marketplace and social listings. Only first-party storefronts.

---

## 3. Actors

| Actor | Interest |
|---|---|
| Analyst | Compares assortment, pricing and sentiment across brands |
| Product manager | Tracks a competitor's line and generation changes |
| Operator | Runs and monitors collection; diagnoses failed runs |
| Scheduler | Unattended process that triggers collection |

---

## 4. Functional requirements

### 4.1 Collection

- **FR-1** The system SHALL collect from multiple storefronts, each identified
  by brand and country, defined in configuration rather than code.
- **FR-2** The system SHALL support more than one storefront platform through a
  per-platform adapter behind a common interface.
- **FR-3** Collection SHALL be rate-limited per storefront by a configurable
  delay, and SHALL identify itself honestly via user agent.
- **FR-4** The system SHALL respect a storefront's published crawler directives.
- **FR-5** A collection run SHALL be resumable in stages, so that a failure in a
  later stage does not require repeating an expensive earlier one.
- **FR-6** A failure affecting one product SHALL NOT abort collection for the
  remaining products. The run completes and is recorded as partial.
- **FR-7** Every run SHALL be recorded with its outcome and per-stage counters.

### 4.2 Normalisation

- **FR-8** The system SHALL reconstruct a hierarchy from flat listings:
  category → line → generation → variant attributes → purchasable item.
- **FR-9** Attribute extraction SHALL be rule-driven and deterministic, with
  vocabularies held in configuration.
- **FR-10** An attribute that cannot be resolved SHALL be recorded as
  unresolved. It SHALL NOT be guessed, and SHALL NOT cause the item to be
  dropped.
- **FR-11** The system SHALL detect the same item listed more than once and
  reconcile the duplicates rather than counting them separately.
- **FR-12** The system SHALL distinguish items that belong to the tracked
  assortment from incidental items that appear alongside them.

### 4.3 History

- **FR-13** Observations SHALL be append-only. Correcting history by rewriting
  it is prohibited.
- **FR-14** Each run SHALL record one observation per tracked item, including
  when nothing changed, so that a flat line means "observed, unchanged" and not
  "not observed".
- **FR-15** The system SHALL derive discrete change events — price moved,
  discount began or ended, stock state changed, item added or withdrawn — from
  consecutive observations.
- **FR-16** An implausible price movement SHALL be quarantined for review rather
  than silently written, since a parsing error and a genuine repricing are
  indistinguishable downstream.

### 4.4 Reviews

- **FR-17** The system SHALL collect reviews from multiple third-party review
  platforms through a per-platform adapter behind a common interface.
- **FR-18** The review platform in use SHALL be configuration, resolved per
  storefront, and a storefront with none configured SHALL be skipped **visibly**
  rather than silently.
- **FR-19** A review SHALL be stored once per source identity and updated on
  re-collection, carrying both when the customer wrote it and when the system
  first and last saw it.
- **FR-20** Ratings without text SHALL be retained and SHALL count toward
  aggregates, but SHALL be distinguishable so they never surface as empty cards
  in a text search.
- **FR-21** Brand replies SHALL be collected where the platform exposes them,
  and their absence SHALL be recorded as a genuine absence rather than a
  collection failure.
- **FR-22** Per-product review aggregates SHALL be snapshotted per run, bucketed
  by rating, so a distribution over time is a range scan rather than a
  recomputation over every review ever collected.
- **FR-23** Reviews SHALL be full-text searchable, with a fallback for terms
  that stemming would otherwise destroy, such as model numbers and part codes.
- **FR-24** Where a review platform syndicates one review across several
  listings of the same product, the system SHALL count it as one opinion. Any
  figure shown to a user SHALL state which of the two it is counting —
  **opinions** or **placements** — and SHALL NOT mix them.

### 4.5 Presentation

- **FR-25** The dashboard SHALL provide: an overview, a catalogue, reviews,
  discounts, a change log, and collection status.
- **FR-26** Brand scope SHALL be a single control owned by the application
  shell. No screen may offer a second control writing the same scope.
- **FR-27** All filter, sort, scope and pagination state SHALL live in the URL,
  so any view can be shared, bookmarked and reopened exactly as seen.
- **FR-28** Any count shown on a control SHALL equal the number of results
  activating that control produces.
- **FR-29** Where a list can grow unbounded — products, brands — the interface
  SHALL provide search rather than relying on scrolling.
- **FR-30** Every screen backed by a query SHALL render a loading state, so a
  slow response is visible as progress rather than as a dead control.
- **FR-31** A failed query SHALL degrade to a readable error on that screen
  only, never a blank page, and never an error that leaks internals.

---

## 5. Data requirements

- **DR-1** Reference data (brands, storefronts, vocabularies) SHALL be
  declared in version-controlled configuration and pushed to the store, so the
  database follows the repository and not the reverse.
- **DR-2** Schema changes SHALL be ordered, individually transactional, and
  recorded, so that a failure rolls back cleanly and re-application is safe.
- **DR-3** Every observation SHALL carry the identity of the run that produced
  it, so any figure can be traced to a collection event.
- **DR-4** The store SHALL distinguish *what a source claims* from *what the
  system holds*. A truncated collection must be visible, not silent.
- **DR-5** Aggregates presented to users SHALL be derived from stored rows, not
  from a source's self-reported totals, wherever the two can diverge.

---

## 6. Non-functional requirements

### 6.1 Correctness

- **NFR-1** Identical input SHALL produce identical normalisation. No
  non-determinism in extraction.
- **NFR-2** Re-running a collection SHALL be idempotent: no duplicate rows, and
  first-seen dates preserved.
- **NFR-3** Counters reported by a run SHALL reflect rows actually written, not
  rows fetched, wherever the two differ.

### 6.2 Robustness

- **NFR-4** External responses SHALL be treated as untrusted. A field of an
  unexpected type SHALL degrade that field only, never abort a stage.
- **NFR-5** Transient failures SHALL be retried with backoff; persistent ones
  SHALL be recorded and surfaced.
- **NFR-6** Paginated sources SHALL be read to completion, and any cap that
  bounds coverage SHALL be logged rather than applied silently.

### 6.3 Performance

- **NFR-7** A dashboard screen SHALL render within ~2 seconds under normal
  conditions.
- **NFR-8** Aggregates SHALL be answered by pre-computed views or indexes rather
  than by many round trips per screen.
- **NFR-9** Time-series queries SHALL remain range scans as history grows.

### 6.4 Security and privacy

- **NFR-10** Credentials SHALL be supplied by environment only, never committed,
  and their absence SHALL fail loudly at first use with an actionable message.
- **NFR-11** A privileged database identity SHALL never be exposed to a browser.
- **NFR-12** Row-level access control SHALL be deny-by-default, with read access
  granted explicitly.
- **NFR-13** Any endpoint that triggers collection SHALL be authenticated when
  reachable from a public network. An unset secret SHALL NOT silently disable
  the check.
- **NFR-14** Only the author display name a storefront already publishes SHALL
  be retained. No contact details, no attempt to identify a reviewer.

### 6.5 Operability

- **NFR-15** Collection SHALL be runnable unattended on a schedule, and
  manually for one storefront.
- **NFR-16** A dry-run mode SHALL exercise collection and normalisation with no
  writes.
- **NFR-17** Logs SHALL be structured and SHALL state what was collected, what
  was skipped, and why.
- **NFR-18** Overlapping runs against one storefront SHALL be prevented.

---

## 7. Constraints and assumptions

- **C-1** Sources are public and unversioned. Markup and payload shapes change
  without notice; adapters are expected to need maintenance.
- **C-2** Collection cadence bounds resolution. A change occurring and reversing
  between two runs is unobservable and must not be presented as absence.
- **C-3** Review platforms disagree on structure, identity and whether replies
  exist at all. The common model is a lowest common denominator plus a retained
  raw payload.
- **C-4** Historical depth accrues only from the first run onward. A missed run
  is a permanent hole.

---

## 8. Known limitations

Recorded because they shape what the data can honestly be asked.

- **L-1** A syndicated review is attached to exactly one listing. Per-listing
  review queries for the other listings are therefore unanswerable, and those
  listings are omitted rather than shown as empty.
- **L-2** Where a source reports totals it will not fully serve, the system
  stores its own count alongside the claim; the two legitimately differ.
- **L-3** Attribute vocabularies are curated. A genuinely new attribute is
  recorded as unresolved until the vocabulary is extended.

---

## 9. Acceptance criteria

The system is acceptable when:

1. A configured storefront can be collected end to end, producing a hierarchy,
   observations and review aggregates, with a recorded run and no silent skips.
2. Re-running collection changes no first-seen date and creates no duplicates.
3. A price change, a stock change and a new review each appear as a change or
   observation attributable to a run.
4. Adding a brand requires configuration and vocabulary only — no changes to
   collection, normalisation or presentation code.
5. Every control's count matches its result, and every view is reproducible from
   its URL alone.
6. No credential appears in the repository, and the application fails with an
   actionable message when one is absent.
