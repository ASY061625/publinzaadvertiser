"use client";

import { CheckList, Section, Toggle, type Option } from "./primitives";
import { countryName, languageName } from "@/lib/format";
import { EMPTY_FILTERS, SENSITIVE_TOPICS, activeFilterCount, type Facets, type FilterState } from "./types";

// Price inputs are shown in whole dollars but held as cents, so the UI never
// does currency arithmetic on a fractional value.
function dollarsToCents(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Math.round(n * 100));
}

function centsToDollars(cents: string): string {
  if (cents === "") return "";
  return String(Math.round(Number(cents) / 100));
}

export function FilterRail({
  filters,
  onChange,
  facets,
  open,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  facets: Facets;
  open: boolean;
}) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: value });

  const topicOptions: Option[] = facets.categories.map((c) => ({ value: c.slug, label: c.name }));
  const countryOptions: Option[] = facets.countries.map((c) => ({
    value: c.code,
    label: `${countryName(c.code)} (${c.count})`,
  }));
  const languageOptions: Option[] = facets.languages.map((l) => ({
    value: l.code,
    label: `${languageName(l.code)} (${l.count})`,
  }));

  const active = activeFilterCount(filters);

  return (
    <aside className={"rail" + (open ? " open" : "")}>
      <div className="rail-head">
        <h2>Filters</h2>
        {active > 0 && (
          <button className="link-btn" onClick={() => onChange(EMPTY_FILTERS)}>
            Reset all
          </button>
        )}
      </div>

      <input
        className="search"
        value={filters.q}
        onChange={(e) => set("q", e.target.value)}
        placeholder="Search domain"
      />

      <Section title="Topic" count={filters.topics.length}>
        <CheckList
          options={topicOptions}
          value={filters.topics}
          onChange={(v) => set("topics", v)}
          searchable
          height={168}
        />
      </Section>

      <Section title="Country" count={filters.countries.length} defaultOpen={false}>
        <CheckList
          options={countryOptions}
          value={filters.countries}
          onChange={(v) => set("countries", v)}
          searchable
          height={168}
        />
      </Section>

      <Section title="Language" count={filters.languages.length} defaultOpen={false}>
        <CheckList
          options={languageOptions}
          value={filters.languages}
          onChange={(v) => set("languages", v)}
          searchable
          height={168}
        />
      </Section>

      <Section title="Domain rating" count={filters.drMin > 0 || filters.drMax < 100 ? 1 : 0}>
        <div className="range-vals">
          <span className="mono">{filters.drMin}</span>
          <span className="range-dash" />
          <span className="mono">{filters.drMax}</span>
        </div>
        <label className="range-lab" htmlFor="dr-min">
          Minimum
        </label>
        <input
          id="dr-min"
          type="range"
          min="0"
          max="100"
          value={filters.drMin}
          onChange={(e) => set("drMin", Math.min(Number(e.target.value), filters.drMax))}
        />
        <label className="range-lab" htmlFor="dr-max">
          Maximum
        </label>
        <input
          id="dr-max"
          type="range"
          min="0"
          max="100"
          value={filters.drMax}
          onChange={(e) => set("drMax", Math.max(Number(e.target.value), filters.drMin))}
        />
      </Section>

      <Section
        title="Traffic & price"
        count={
          (filters.trafficMin ? 1 : 0) +
          (filters.priceMinCents !== "" || filters.priceMaxCents !== "" ? 1 : 0)
        }
      >
        <label className="range-lab" htmlFor="traffic-min">
          Monthly organic traffic
        </label>
        <select
          id="traffic-min"
          value={filters.trafficMin}
          onChange={(e) => set("trafficMin", Number(e.target.value))}
        >
          <option value={0}>Any</option>
          <option value={10000}>10K and above</option>
          <option value={50000}>50K and above</option>
          <option value={100000}>100K and above</option>
          <option value={250000}>250K and above</option>
        </select>

        <label className="range-lab">Price per placement</label>
        <div className="pair">
          <input
            type="number"
            min="0"
            placeholder="Min"
            aria-label="Minimum price in dollars"
            value={centsToDollars(filters.priceMinCents)}
            onChange={(e) => set("priceMinCents", dollarsToCents(e.target.value))}
          />
          <input
            type="number"
            min="0"
            placeholder="Max"
            aria-label="Maximum price in dollars"
            value={centsToDollars(filters.priceMaxCents)}
            onChange={(e) => set("priceMaxCents", dollarsToCents(e.target.value))}
          />
        </div>
      </Section>

      <Section
        title="Placement rules"
        count={
          (filters.dofollowOnly ? 1 : 0) +
          (filters.gaVerifiedOnly ? 1 : 0) +
          (filters.maxTurnaroundDays ? 1 : 0) +
          filters.accepts.length
        }
      >
        <Toggle
          checked={filters.dofollowOnly}
          onChange={(v) => set("dofollowOnly", v)}
          label="Dofollow links only"
        />
        <Toggle
          checked={filters.gaVerifiedOnly}
          onChange={(v) => set("gaVerifiedOnly", v)}
          label="Analytics-verified traffic"
        />

        <label className="range-lab" htmlFor="turnaround">
          Publishes within
        </label>
        <select
          id="turnaround"
          value={filters.maxTurnaroundDays}
          onChange={(e) => set("maxTurnaroundDays", Number(e.target.value))}
        >
          <option value={0}>Any turnaround</option>
          <option value={4}>4 days</option>
          <option value={7}>7 days</option>
          <option value={10}>10 days</option>
          <option value={14}>14 days</option>
        </select>

        <label className="range-lab">Accepts restricted topics</label>
        <div className="chips">
          {SENSITIVE_TOPICS.map((topic) => (
            <button
              key={topic}
              className={"chip" + (filters.accepts.includes(topic) ? " on" : "")}
              aria-pressed={filters.accepts.includes(topic)}
              onClick={() =>
                set(
                  "accepts",
                  filters.accepts.includes(topic)
                    ? filters.accepts.filter((x) => x !== topic)
                    : [...filters.accepts, topic]
                )
              }
            >
              {topic}
            </button>
          ))}
        </div>
      </Section>
    </aside>
  );
}
