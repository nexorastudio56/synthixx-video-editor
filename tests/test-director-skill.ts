import { strict as assert } from "node:assert";
import { DIRECTOR_PRIMITIVE_IDS, routeDirectorSkill } from "../intelligence/directorSkill.js";

assert.equal(DIRECTOR_PRIMITIVE_IDS.length, 24, "all 24 semantic primitives are registered");
const compare = routeDirectorSkill("Tool A is faster than Tool B versus the old workflow.", [], true);
assert.equal(compare.primitive, "P11_comparison_split");
const metric = routeDirectorSkill("Revenue is 35% with 2 million users.", ["metric"], false);
assert.equal(metric.primitive, "P07_metric_card");
const ui = routeDirectorSkill("Open the browser and click the dashboard.", ["browser"], false);
assert.equal(ui.primitive, "P19_ui_demo");
const process = routeDirectorSkill("First connect the trigger, then automate the workflow.", ["workflow"], false);
assert.equal(process.primitive, "P13_list_stack"); // explicit ordered-list cue takes precedence
assert.equal(routeDirectorSkill("Show the product footage.", [], false).primitive, "P04_hero_media");
assert.equal(routeDirectorSkill("A cityscape establishes the setting.", [], false).primitive, "P05_establishing_shot");
assert.equal(routeDirectorSkill("This hierarchy has three levels.", [], false).primitive, "P18_hierarchy_pyramid");
assert.equal(routeDirectorSkill("The important key point is simple.", [], false).primitive, "P02_kinetic_emphasis");
assert.ok(routeDirectorSkill("A neutral generic sentence.", [], false).candidates.length > 0);
console.log("Director skill tests passed: 24 primitives, deterministic precedence, supported archetype candidates.");
