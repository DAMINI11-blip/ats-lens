/* =========================================================
   ATS_SCANNER — keyword extraction & matching logic
   ========================================================= */

// Standard English stopwords
const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","for","nor","so","yet",
  "of","in","on","at","by","to","from","with","without","about","as","into",
  "like","through","after","over","between","out","against","during","before",
  "above","below","up","down","off","again","further","once","here","there",
  "when","where","why","how","all","any","both","each","few","more","most",
  "other","some","such","no","not","only","own","same","than","too","very",
  "can","will","just","should","now","is","are","was","were","be","been",
  "being","have","has","had","having","do","does","did","doing","would",
  "could","might","must","shall","this","that","these","those","i","you",
  "he","she","it","we","they","me","him","her","us","them","my","your","his",
  "its","our","their","who","whom","which","what","also","etc","per","via",
  "within","across","upon","re","one","two","three"
]);

// Generic resume/JD filler words — technically words, but too vague to be
// useful "keywords" for ATS matching purposes.
const FILLER_WORDS = new Set([
  "experience","experienced","responsible","responsibility","responsibilities","strong","excellent",
  "ability","abilities","knowledge","proven","demonstrated","preferred","required","requirement",
  "requirements","plus","years","year","including","include","includes","use","using","used","work",
  "working","works","environment","team","teams","role","roles","position","company","looking",
  "join","ideal","candidate","candidates","job","description","duties","day","related",
  "help","helping","various","new","good","great","time","well","ensure","ensuring","support","supporting",
  "provide","providing","apply","applicants","applicant","opportunity","employer","applications",
  "application","develop","developer","developers","build","building","understanding","familiarity","web",
  "junior","senior","maintain","maintainable","write","clean","participate","collaborate","consume",
  "consuming","collaborating","participating","communicate","communication","communicating","communicates",
  "communicated","designers","best","practices","apis"
]);

// =========================================================
// HIGH-VALUE ATS KEYWORDS
// =========================================================
// Predefined high-value ATS skills/terms. These are always checked for
// directly (case-insensitive substring match against the JD) and are
// prioritized over the auto-extracted keywords below.
const ATS_KEYWORDS = [
  "javascript",
  "react.js",
  "node.js",
  "express.js",
  "mongodb",
  "html",
  "css",
  "git",
  "rest api",
  "api integration",
  "responsive design",
  "version control",
  "testing",
  "code reviews",
  "deployment",
  "cloud platforms",
  "communication skills",
  "full stack developer",
  "problem-solving",
  "software development",
  "backend"
];

// score thresholds, single source of truth for gauge color + label + copy tone
const SCORE_BANDS = {
  strong: 80,
  partial: 50
};

const TOKEN_RE = /[a-zA-Z][a-zA-Z0-9+.#-]{1,}/g;
// splits on sentence-ending punctuation / line breaks so bigrams never
// straddle two unrelated sentences
const SENTENCE_SPLIT_RE = /[.!?\n\r]+/;

function tokenize(text) {
  const raw = text.match(TOKEN_RE) || [];
  return raw
    .map(w => w.toLowerCase().replace(/^[.\-#+]+|[.\-#+]+$/g, ""))
    .filter(w => w.length >= 3)
    .filter(w => !STOPWORDS.has(w))
    .filter(w => !FILLER_WORDS.has(w))
    .filter(w => /[a-zA-Z]/.test(w));
}

// crude stemmer for matching only (never used for display)
function stem(word) {
  return word
    .replace(/(ing|edly|ingly)$/, '')
    .replace(/(ies)$/, 'y')
    .replace(/(es)$/, '')
    .replace(/([^s])s$/, '$1')
    .replace(/(ed)$/, '');
}

// strips a trailing ".js"/".ts" so "react.js" and "react" (or "node.js"
// and "node") are treated as the same skill for matching/dedupe purposes
function stripJsTsSuffix(word) {
  return word.replace(/\.(js|ts)$/i, "");
}

// a few common word-family variants the crude stemmer above can't unify
// (e.g. "deploy"/"deploying"/"deployed" vs "deployment") — keeps a single
// canonical keyword instead of both matched AND missing/duplicate entries
const WORD_FAMILIES = {
  deploy: "deployment",
  deploying: "deployment",
  deployed: "deployment",
  deploys: "deployment"
};

// canonical form used ONLY for equality checks (dedupe / matching),
// never for anything shown to the user
function canonicalize(word) {
  const base = stripJsTsSuffix(word.toLowerCase());
  const family = WORD_FAMILIES[base] || base;
  return stem(family);
}

function extractKeywords(text, maxTerms = 40) {
  // tokenize per-sentence so bigrams don't cross sentence boundaries
  const sentences = text.split(SENTENCE_SPLIT_RE);
  const allTokens = [];
  const freq = new Map();
  const bigramFreq = new Map();

  sentences.forEach(sentence => {
    const tokens = tokenize(sentence);
    allTokens.push(...tokens);

    tokens.forEach(t => freq.set(t, (freq.get(t) || 0) + 1));

    for (let i = 0; i < tokens.length - 1; i++) {
      const bg = tokens[i] + " " + tokens[i + 1];
      bigramFreq.set(bg, (bigramFreq.get(bg) || 0) + 1);
    }
  });

  const keywords = [];

  // strong bigrams first (repeated multi-word terms carry real signal)
  bigramFreq.forEach((count, phrase) => {
    if (count >= 2) keywords.push({ term: phrase, count: count * 2, type: "phrase" });
  });

  freq.forEach((count, word) => {
    keywords.push({ term: word, count, type: "word" });
  });

  keywords.sort((a, b) => b.count - a.count);

  // de-dupe words that are already fully covered by a chosen phrase
  const chosen = [];
  const usedWords = new Set();
  for (const kw of keywords) {
    if (chosen.length >= maxTerms) break;
    if (kw.type === "word" && usedWords.has(kw.term)) continue;
    chosen.push(kw);
    if (kw.type === "phrase") {
      kw.term.split(" ").forEach(w => usedWords.add(w));
    } else {
      usedWords.add(kw.term);
    }
  }

  return chosen;
}

function buildJDKeywords(jdText, maxTerms = 40) {
  const lowerJD = jdText.toLowerCase();

  // 1. Predefined ATS skills that actually appear in this JD, always win
  //    and are ranked first (high synthetic count so they sort to the top).
  const atsMatches = ATS_KEYWORDS
    .filter(k => lowerJD.includes(k))
    .map(k => ({ term: k, count: 100, type: k.includes(" ") ? "phrase" : "word" }));

  const atsTermSet = new Set(atsMatches.map(k => k.term));
  // canonical forms (not raw strings) so "react.js" also covers "react",
  // and "deployment" also covers "deploying"/"deployed"/etc.
  const atsCanonSet = new Set(
    atsMatches.flatMap(k => k.term.split(" ").map(w => canonicalize(w)))
  );

  // 2. Auto-extracted keywords fill in anything the predefined list misses
  //    (e.g. Docker, Kubernetes, Next.js — tools not in ATS_KEYWORDS),
  //    skipping anything already represented by an ATS match (including
  //    word-family variants like react/react.js or deploying/deployment).
  const autoKeywords = extractKeywords(jdText, maxTerms)
    .filter(kw => !atsTermSet.has(kw.term))
    .filter(kw => kw.type === "phrase" || !atsCanonSet.has(canonicalize(kw.term)));

  return [...atsMatches, ...autoKeywords].slice(0, maxTerms);
}

function buildMatchIndex(text) {
  const tokens = tokenize(text);
  const rawSet = new Set(tokens);
  // also index the .js/.ts-stripped + word-family-normalized form of each
  // token, so "React.js" in a resume matches a JD keyword of "react" and
  // vice versa, same for deploy/deploying/deployed/deployment
  const canonSet = new Set(tokens.map(t => canonicalize(t)));
  const stemmed = new Set(tokens.map(stem));
  return { stemmed, rawSet, canonSet, lower: text.toLowerCase() };
}

// =========================================================
// NORMALIZE SIMILAR TERMS
// =========================================================
function normalizeTerm(term) {
  return term
    .toLowerCase()
    .replace("rest apis", "rest api")
    .replace("deploying", "deployment")
    .replace("developers", "developer")
    .trim();
}

function isKeywordPresent(term, index) {
  term = normalizeTerm(term);
  const parts = term.split(" ");
  if (parts.length === 1) {
    return index.rawSet.has(term) ||
      index.stemmed.has(stem(term)) ||
      index.canonSet.has(canonicalize(term));
  }
  // phrase: check as substring OR all constituent words present
  if (index.lower.includes(term)) return true;
  return parts.every(p =>
    index.rawSet.has(p) ||
    index.stemmed.has(stem(p)) ||
    index.canonSet.has(canonicalize(p))
  );
}

/* =========================================================
   UI wiring
   ========================================================= */

const resumeInput = document.getElementById("resumeInput");
const jdInput = document.getElementById("jdInput");
const resumeCount = document.getElementById("resumeCount");
const jdCount = document.getElementById("jdCount");
const scanBtn = document.getElementById("scanBtn");
const runHint = document.getElementById("runHint");
const resultsSection = document.getElementById("results");

const gaugeFill = document.getElementById("gaugeFill");
const gaugeScore = document.getElementById("gaugeScore");
const gaugeLabel = document.getElementById("gaugeLabel");
const statMatched = document.getElementById("statMatched");
const statMissing = document.getElementById("statMissing");
const statTotal = document.getElementById("statTotal");
const matchedChips = document.getElementById("matchedChips");
const missingChips = document.getElementById("missingChips");
const matchedTotal = document.getElementById("matchedTotal");
const missingTotal = document.getElementById("missingTotal");
const suggestionsList = document.getElementById("suggestionsList");
const copyBtn = document.getElementById("copyBtn");
const copyToast = document.getElementById("copyToast");

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 88;

// results heading is announced to screen readers whenever a new scan lands
if (resultsSection) {
  const heading = resultsSection.querySelector(".results-top h2");
  if (heading) heading.setAttribute("aria-live", "polite");
}

// gauge is decorative SVG by default — give it a real accessible value
if (gaugeFill && gaugeFill.closest("svg")) {
  const svg = gaugeFill.closest("svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "ATS match score");
}

function wordCount(text) {
  const n = (text.trim().match(/\S+/g) || []).length;
  return `${n} word${n === 1 ? "" : "s"}`;
}

function updateCounts() {
  resumeCount.textContent = wordCount(resumeInput.value);
  jdCount.textContent = wordCount(jdInput.value);
  const ready = resumeInput.value.trim().length > 0 && jdInput.value.trim().length > 0;
  scanBtn.disabled = !ready;
  runHint.textContent = ready
    ? "Ready to scan."
    : "Paste both fields to enable scanning.";
}

resumeInput.addEventListener("input", updateCounts);
jdInput.addEventListener("input", updateCounts);
updateCounts();

// matches the token vars actually defined in style.css (no --amber there)
function scoreColor(score) {
  if (score >= SCORE_BANDS.strong) return "var(--green)";
  if (score >= SCORE_BANDS.partial) return "var(--cyan)";
  return "var(--magenta)";
}

function scoreLabel(score) {
  if (score >= SCORE_BANDS.strong) return "STRONG MATCH";
  if (score >= SCORE_BANDS.partial) return "PARTIAL MATCH";
  return "WEAK MATCH";
}

// =========================================================
// REMOVE DUPLICATE KEYWORDS
// =========================================================
function uniqueKeywords(arr) {
  return [...new Map(
    arr.map(item => [
      item.type === "phrase" ? item.term.toLowerCase() : canonicalize(item.term),
      item
    ])
  ).values()];
}

function runScan() {
  const jdText = jdInput.value;
  const resumeText = resumeInput.value;

  const jdKeywords = buildJDKeywords(jdText, 40);
  const resumeIndex = buildMatchIndex(resumeText);

  let matched = [];
  let missing = [];

  jdKeywords.forEach(kw => {
    if (isKeywordPresent(kw.term, resumeIndex)) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  });

  matched = uniqueKeywords(matched);
  missing = uniqueKeywords(missing);

  const total = matched.length + missing.length || 1;
  const score = Math.round((matched.length / total) * 100);

  renderResults({ score, matched, missing, total });
}

function renderResults({ score, matched, missing, total }) {
  resultsSection.hidden = false;

  // gauge
  const offset = GAUGE_CIRCUMFERENCE - (GAUGE_CIRCUMFERENCE * score) / 100;
  const color = scoreColor(score);
  gaugeFill.style.stroke = color;
  gaugeFill.style.transition = "none";
  gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
  void gaugeFill.getBoundingClientRect();
  gaugeFill.style.transition = "";
  requestAnimationFrame(() => {
    gaugeFill.style.strokeDashoffset = offset;
  });

  const svg = gaugeFill.closest("svg");
  if (svg) svg.setAttribute("aria-label", `ATS match score: ${score} percent, ${scoreLabel(score).toLowerCase()}`);

  gaugeScore.textContent = `${score}%`;
  gaugeScore.style.color = color;
  gaugeLabel.textContent = scoreLabel(score);

  statMatched.textContent = matched.length;
  statMissing.textContent = missing.length;
  statTotal.textContent = total;

  matchedTotal.textContent = matched.length;
  missingTotal.textContent = missing.length;

  matchedChips.innerHTML = "";
  if (matched.length === 0) {
    matchedChips.innerHTML = `<span class="kw-empty">No matches found yet.</span>`;
  } else {
    matched
      .sort((a, b) => b.count - a.count)
      .forEach(kw => {
        const el = document.createElement("span");
        el.className = "chip chip--match";
        el.textContent = kw.term;
        matchedChips.appendChild(el);
      });
  }

  missingChips.innerHTML = "";
  if (missing.length === 0) {
    missingChips.innerHTML = `<span class="kw-empty">Nothing missing — great coverage.</span>`;
  } else {
    missing
      .sort((a, b) => b.count - a.count)
      .forEach(kw => {
        const el = document.createElement("span");
        el.className = "chip chip--miss";
        el.textContent = kw.term;
        missingChips.appendChild(el);
      });
  }

  renderSuggestions({ score, matched, missing });

  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSuggestions({ score, matched, missing }) {
  const tips = [];

  if (score >= SCORE_BANDS.strong) {
    tips.push("Strong overlap with this job description — your resume already speaks the ATS's language.");
  } else if (score >= SCORE_BANDS.partial) {
    tips.push("Decent overlap, but a handful of high-value terms from the posting aren't showing up in your resume yet.");
  } else {
    tips.push("Low overlap. Many core terms from this job description are missing from your resume — an ATS is likely to rank this application low.");
  }

  if (missing.length > 0) {
    const topMissing = [...missing].sort((a, b) => b.count - a.count).slice(0, 6).map(k => k.term);
    tips.push(`Work these into your bullet points where genuinely true: ${topMissing.join(", ")}.`);
  }

  tips.push("Use the exact phrasing from the job description where possible — ATS matching is usually literal, not semantic.");
  tips.push("Place important keywords in your skills section and at least once in a relevant experience bullet, not just a list.");

  if (missing.some(k => k.type === "phrase")) {
    tips.push("Some missing terms are multi-word phrases — check whether you're describing the same skill with different wording.");
  }

  suggestionsList.innerHTML = "";
  tips.forEach(t => {
    const li = document.createElement("li");
    li.textContent = t;
    suggestionsList.appendChild(li);
  });

  return tips;
}

function triggerLaserSweep() {
  const sweep = document.createElement("div");
  sweep.className = "laser-sweep";
  document.body.appendChild(sweep);
  sweep.addEventListener("animationend", () => sweep.remove());
}

scanBtn.addEventListener("click", () => {
  if (scanBtn.disabled) return;
  scanBtn.classList.add("scanning");
  triggerLaserSweep();
  scanBtn.disabled = true;

  setTimeout(() => {
    runScan();
    scanBtn.classList.remove("scanning");
    scanBtn.disabled = false;
  }, 700);
});

copyBtn.addEventListener("click", () => {
  const score = gaugeScore.textContent;
  const matched = Array.from(matchedChips.querySelectorAll(".chip")).map(c => c.textContent);
  const missing = Array.from(missingChips.querySelectorAll(".chip")).map(c => c.textContent);
  const suggestions = Array.from(suggestionsList.querySelectorAll("li")).map(li => `- ${li.textContent}`);

  const report = [
    `ATS MATCH SCORE: ${score}`,
    ``,
    `CORE SKILLS MATCHED (${matched.length}):`,
    matched.length ? matched.join(", ") : "None",
    ``,
    `TOP MISSING SKILLS (${missing.length}):`,
    missing.length ? missing.join(", ") : "None",
    ``,
    `OPTIMIZATION RECOMMENDATIONS:`,
    suggestions.length ? suggestions.join("\n") : "None",
  ].join("\n");

  navigator.clipboard.writeText(report).then(() => {
    copyToast.textContent = "Report copied successfully";
    copyToast.classList.add("show");
    setTimeout(() => copyToast.classList.remove("show"), 2000);
  }).catch(() => {
    copyToast.textContent = "Copy failed — select and copy manually.";
    copyToast.classList.add("show");
    setTimeout(() => copyToast.classList.remove("show"), 2500);
  });
});