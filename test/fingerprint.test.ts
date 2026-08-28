import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, normaliseStatement } from "../src/lib/memory/fingerprint.ts";
import { normaliseAttribute, isSingleValued } from "../src/lib/memory/attributes.ts";

test("the same fact phrased with different casing and punctuation fingerprints identically", () => {
  assert.equal(
    fingerprint("location", "Lives in Cebu"),
    fingerprint("location", "  lives in cebu.  "),
  );
});

test("accents fold away so one spelling does not become two facts", () => {
  assert.equal(normaliseStatement("Lives in Québec"), "lives in quebec");
});

test("negation is preserved, because a false duplicate silently destroys a fact", () => {
  assert.notEqual(
    fingerprint("employer", "Works at Acme"),
    fingerprint("employer", "Does not work at Acme"),
  );
});

test("the same words under different attributes stay separate facts", () => {
  assert.notEqual(fingerprint("location", "Manila"), fingerprint("goal", "Manila"));
});

test("attribute aliases fold onto one slug", () => {
  assert.equal(normaliseAttribute("City"), "location");
  assert.equal(normaliseAttribute(" Job Title "), "job_title");
  assert.equal(normaliseAttribute("Company"), "employer");
  assert.equal(normaliseAttribute("!!!"), "other");
});

test("cardinality is decided by the registry, not by the model", () => {
  assert.equal(isSingleValued("location"), true);
  assert.equal(isSingleValued("City"), true);
  assert.equal(isSingleValued("likes"), false);
  assert.equal(isSingleValued("favourite_biscuit"), false, "unknown attributes append rather than replace");
});
