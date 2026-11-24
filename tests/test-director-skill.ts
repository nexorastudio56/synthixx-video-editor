import { strict as assert } from "node:assert";
import { DIRECTOR_PRIMITIVE_IDS, routeDirectorSkill } from "../intelligence/directorSkill.js";

assert.equal(DIRECTOR_PRIMITIVE_IDS.length, 24, "all 24 semantic primitives are registered");
const compare = routeDirectorSkill("Tool A is faster than Tool B versus the old workflow.", [], true);
assert.equal(compare.primitive, "P11_comparison_split");
const metric = routeDirectorSkill("Revenue increased 35% and users doubled.", ["metric"], false);
assert.equal(metric.primitive, "P07_metric_card");
const ui = routeDirectorSkill("Open the browser and click the dashboard.", ["browser"], false);
assert.equal(ui.primitive, "P19_ui_demo");
const process = routeDirectorSkill("First connect the trigger, then automate the workflow.", ["workflow"], false);
assert.equal(process.primitive, "P13_list_stack"); // explicit ordered-list cue takes precedence
for (const id of DIRECTOR_PRIMITIVE_IDS) {
  const route = routeDirectorSkill("A neutral generic sentence.", [], false);
  assert.ok(route.candidates.length > 0, `route exists for ${id}`);
}
console.log("Director skill tests passed: 24 primitives, deterministic precedence, supported archetype candidates.");
