/**
 * Synthixx Deterministic Director Skill
 * Semantic routing only: this module selects an existing engine archetype.
 * It never emits HTML, CSS, SVG, geometry, coordinates, or arbitrary render code.
 * Every route is bounded by the current SceneGraph archetype enum.
 */
import type { Archetype } from "../schemas/scene.schema.js";
import type { Comp } from "./narrative.js";

export type PrimitiveId =
  | "P01_thesis_hero" | "P02_kinetic_emphasis" | "P03_question_hook" | "P04_hero_media"
  | "P05_establishing_shot" | "P06_map_context" | "P07_metric_card" | "P08_data_chart"
  | "P09_quote_card" | "P10_source_document" | "P11_comparison_split" | "P12_before_after"
  | "P13_list_stack" | "P14_timeline" | "P15_process_flow" | "P16_causal_chain"
  | "P17_system_map" | "P18_hierarchy_pyramid" | "P19_ui_demo" | "P20_annotated_callout"
  | "P21_analogy_metaphor" | "P22_chapter_transition" | "P23_recap_synthesis" | "P24_cta_action";

export interface DirectorRoute {
  primitive: PrimitiveId;
  candidates: Archetype[];
  evidence: string[];
}

/** 24 semantic scene roles mapped onto archetypes already implemented by this repo. */
const ROUTES: Record<PrimitiveId, Archetype[]> = {
  P01_thesis_hero: ["hero_object", "device_showcase"],
  P02_kinetic_emphasis: ["kinetic_data", "hero_object"],
  P03_question_hook: ["hero_object", "live_ui_action"],
  P04_hero_media: ["device_showcase", "environmental_story"],
  P05_establishing_shot: ["environmental_story", "hero_object"],
  P06_map_context: ["network_graph", "orbit_system"],
  P07_metric_card: ["metric_reveal", "kinetic_data"],
  P08_data_chart: ["kinetic_data", "timeline_journey"],
  P09_quote_card: ["chat_conversation", "hero_object"],
  P10_source_document: ["terminal_run", "live_ui_action"],
  P11_comparison_split: ["split_comparison", "before_after"],
  P12_before_after: ["before_after", "split_comparison"],
  P13_list_stack: ["exploded_view", "card_deck"],
  P14_timeline: ["timeline_journey", "process_simulation"],
  P15_process_flow: ["process_simulation", "workflow_build"],
  P16_causal_chain: ["network_graph", "process_simulation"],
  P17_system_map: ["orbit_system", "network_graph"],
  P18_hierarchy_pyramid: ["exploded_view", "orbit_system"],
  P19_ui_demo: ["live_ui_action", "terminal_run"],
  P20_annotated_callout: ["live_ui_action", "device_showcase"],
  P21_analogy_metaphor: ["environmental_story", "hero_object"],
  P22_chapter_transition: ["hero_object", "environmental_story"],
  P23_recap_synthesis: ["kinetic_data", "timeline_journey"],
  P24_cta_action: ["hero_object", "device_showcase"],
};

export function routeDirectorSkill(text: string, comps: Comp[], split: boolean): DirectorRoute {
  const t = text.toLowerCase();
  const has = (...xs: Comp[]) => xs.some(x => comps.includes(x));
  let primitive: PrimitiveId;
  let evidence: string[] = [];

  // Hard semantic gates take precedence over generic keyword matches.
  if (split || /\b(vs\.?|versus|compared with|on the other hand)\b/.test(t)) {
    primitive = /\b(before|after|used to|now)\b/.test(t) ? "P12_before_after" : "P11_comparison_split";
    evidence = ["explicit comparison cue"];
  } else if (/\?/.test(text) || /\b(why|what if|how can|ever wondered)\b/.test(t)) {
    primitive = "P03_question_hook"; evidence = ["question cue"];
  } else if (/\b(first|second|third|step 1|step 2|finally|next)\b/.test(t)) {
    primitive = "P13_list_stack"; evidence = ["ordered-list cue"];
  } else if (/\b(because|therefore|leads to|causes|as a result)\b/.test(t)) {
    primitive = "P16_causal_chain"; evidence = ["causal connector"];
  } else if (/\b(before|after|previously|now it)\b/.test(t)) {
    primitive = "P12_before_after"; evidence = ["state-change cue"];
  } else if (/\b(roadmap|over time|in 202[0-9]|timeline|by 20[0-9]{2})\b/.test(t)) {
    primitive = "P14_timeline"; evidence = ["temporal anchor"];
  } else if (has("terminal")) {
    primitive = "P10_source_document"; evidence = ["terminal/code evidence"];
  } else if (has("workflow")) {
    primitive = "P15_process_flow"; evidence = ["workflow evidence"];
  } else if (has("browser", "code", "chat")) {
    primitive = "P19_ui_demo"; evidence = ["interface evidence"];
  } else if (has("metric", "dashboard") || /\b(\d+(?:\.\d+)?%|\d+x|million|billion|revenue|users)\b/.test(t)) {
    primitive = /\b(chart|trend|grew|growth|declined|increased|decreased)\b/.test(t) ? "P08_data_chart" : "P07_metric_card";
    evidence = ["numeric or metric evidence"];
  } else if (has("alert")) {
    primitive = "P20_annotated_callout"; evidence = ["notification cue"];
  } else if (/\b(map|region|country|global|across the world)\b/.test(t)) {
    primitive = "P06_map_context"; evidence = ["geographic cue"];
  } else if (/\b(quote|said|according to|wrote)\b/.test(t)) {
    primitive = "P09_quote_card"; evidence = ["attribution cue"];
  } else if (/\b(analogy|imagine|like a|just like)\b/.test(t)) {
    primitive = "P21_analogy_metaphor"; evidence = ["analogy cue"];
  } else if (/\b(in short|to recap|the takeaway|remember this)\b/.test(t)) {
    primitive = "P23_recap_synthesis"; evidence = ["recap cue"];
  } else if (/\b(follow|subscribe|try it|start today|get started)\b/.test(t)) {
    primitive = "P24_cta_action"; evidence = ["action cue"];
  } else if (has("brand")) {
    primitive = "P17_system_map"; evidence = ["brand/entity relation cue"];
  } else if (/\b(chapter|next up|moving on)\b/.test(t)) {
    primitive = "P22_chapter_transition"; evidence = ["chapter cue"];
  } else if (has("metric", "dashboard")) {
    primitive = "P02_kinetic_emphasis"; evidence = ["emphasis cue"];
  } else {
    primitive = "P01_thesis_hero"; evidence = ["safe semantic fallback"];
  }

  return { primitive, candidates: ROUTES[primitive], evidence };
}

export const DIRECTOR_PRIMITIVE_IDS = Object.keys(ROUTES) as PrimitiveId[];
