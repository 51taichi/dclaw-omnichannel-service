const TEMPLATE_TOKEN = /\{\{([\s\S]*?)\}\}/g;
const MAX_VARIABLE_VALUE_LENGTH = 4000;
const MAX_RENDERED_TEMPLATE_LENGTH = 20000;

function parseVariableBody(rawBody) {
  const body = String(rawBody || "").trim();
  const ruleStart = body.indexOf("（");
  const name = (ruleStart < 0 ? body : body.slice(0, ruleStart)).trim();
  if (!name) throw new Error("summary variable name is required");

  if (ruleStart < 0) {
    if (body.includes("）")) throw new Error("unclosed summary variable rule");
    return { name, instruction: name };
  }

  if (!body.endsWith("）")) throw new Error("unclosed summary variable rule");
  const instruction = body.slice(ruleStart + 1, -1).trim();
  if (!instruction) throw new Error("summary variable rule is required");
  if (instruction.includes("（") || instruction.includes("）")) {
    throw new Error("nested or unbalanced summary variable rule");
  }
  return { name, instruction };
}

export function parseGroupSummaryTemplate(value) {
  const template = String(value || "").trim();
  if (!template) throw new Error("summary template is required");

  const variables = [];
  const instructionsByName = new Map();
  for (const match of template.matchAll(TEMPLATE_TOKEN)) {
    const variable = parseVariableBody(match[1]);
    const existingInstruction = instructionsByName.get(variable.name);
    if (existingInstruction != null && existingInstruction !== variable.instruction) {
      throw new Error(`conflicting summary variable: ${variable.name}`);
    }
    if (existingInstruction == null) variables.push(variable);
    instructionsByName.set(variable.name, variable.instruction);
  }

  const unmatched = template.replace(TEMPLATE_TOKEN, "");
  if (unmatched.includes("{{") || unmatched.includes("}}")) {
    throw new Error("unclosed summary variable");
  }

  return { template, variables };
}

export function renderGroupSummaryTemplate(parsedTemplate, values = {}) {
  if (!parsedTemplate || typeof parsedTemplate.template !== "string") {
    throw new Error("parsed summary template is required");
  }

  const rendered = parsedTemplate.template.replace(TEMPLATE_TOKEN, (_, body) => {
    const { name } = parseVariableBody(body);
    if (!Object.hasOwn(values, name)) {
      throw new Error(`missing variable value: ${name}`);
    }
    const value = values[name];
    if (typeof value !== "string") {
      throw new Error(`summary variable must be a scalar string: ${name}`);
    }
    if (value.length > MAX_VARIABLE_VALUE_LENGTH) {
      throw new Error(`summary variable value is too long: ${name}`);
    }
    return value;
  });

  if (rendered.includes("{{") || rendered.includes("}}")) {
    throw new Error("unresolved template syntax");
  }
  if (rendered.length > MAX_RENDERED_TEMPLATE_LENGTH) {
    throw new Error("rendered summary is too long");
  }
  return rendered;
}
