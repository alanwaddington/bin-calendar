// Parenthetical text in East Ayrshire's feed is always an explanatory
// caveat attached to a DIFFERENT collection (e.g. "(+food only after
// transition week)" on a General Waste day) - never an announcement of its
// own, separate collection. A genuinely combined day is always joined with
// "and" instead (see splitSummarySegments below). So a word that only
// appears inside parentheses must never, on its own, trigger a bin_types
// match - verified against every real summary fetched this session.
function stripParentheticals(text) {
  return text.replace(/\([^()]*\)/g, '');
}

// The shared "does this match text genuinely apply to this summary"
// primitive: true only when matchText appears outside any parenthetical
// span, so a caveat buried in parentheses can never cause a false match.
//
// PR #34 review finding C1: a blank (empty or whitespace-only) matchText
// must never match - String.prototype.includes('') is always true, so
// without this guard a single bin_types row whose summary_match was ever
// persisted as '' (e.g. a Match of pure wildcard characters, now also
// rejected at the API boundary) would match every summary. Defense in
// depth: this protects every caller of this primitive, not just the
// opt-in classification in sync.js, regardless of how a blank value
// reached it (existing bad data, a direct DB write, a future caller).
function matchesOutsideParentheses(summary, matchText) {
  if (!matchText || !matchText.trim()) return false;
  return stripParentheticals(summary).toLowerCase().includes(matchText.toLowerCase());
}

// East Ayrshire sometimes combines several collections into one VEVENT by
// literally concatenating each one's own standalone summary with " and "
// (verified against the real feed: "Garden waste and general waste+food
// (+food only after transition week)" is exactly "Garden waste" + " and " +
// "general waste+food (+food only after transition week)" - both halves
// appear verbatim elsewhere in the same feed as standalone single-day
// entries).
function splitSummarySegments(summary) {
  return summary.split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
}

// #35: generalized from Garden-Waste-only - true if any segment of a
// (possibly combined) summary matches one of the given bin_types.
// summary_match values, outside parentheses. The caller decides what the
// matcher list means (e.g. "every opt-in-required bin type this property
// hasn't opted into") - this primitive has no opinion on that.
function matchesAnySegment(summary, matchers) {
  return splitSummarySegments(summary).some(segment =>
    matchers.some(matchText => matchesOutsideParentheses(segment, matchText))
  );
}

// #35: generalized from Garden-Waste-only - removes just the matching
// segment(s) of a (possibly combined) summary, rejoining what's left with
// " and " - so e.g. an opted-out property's combined day still gets its
// non-withheld half pushed. Returns '' when every segment matches, so
// callers can treat that as "skip the push entirely" rather than pushing
// an empty event.
function stripMatchingSegments(summary, matchers) {
  const segments = splitSummarySegments(summary);
  const kept = segments.filter(segment =>
    !matchers.some(matchText => matchesOutsideParentheses(segment, matchText))
  );
  return kept.join(' and ');
}

module.exports = {
  stripParentheticals,
  matchesOutsideParentheses,
  splitSummarySegments,
  matchesAnySegment,
  stripMatchingSegments,
};
