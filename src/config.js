// Reads packages.config, and the parts of web.config and app.config that matter for a move to modern .NET:
// WCF services and client endpoints (system.serviceModel), HTTP modules and handlers (system.web and
// system.webServer), assembly binding redirects (runtime), and the target framework attributes. Nothing
// else in a config file is read, and no value from it (connection strings, keys, addresses) is shown.
// Element names are compared exactly, as the .NET configuration system does.

import { parseXml, attr } from './xml.js';

function kids(el, name) {
  return el ? el.children.filter((c) => c.name === name) : [];
}

function kid(el, name) {
  return kids(el, name)[0] ?? null;
}

// packages.config: [{ id, version, targetFramework, line }]
export function parsePackagesConfig(text, file = 'packages.config') {
  const root = parseXml(text, file);
  if (root.name !== 'packages') throw new Error(`${file}: the root element is <${root.name.slice(0, 40)}>, not <packages>`);
  return kids(root, 'package').map((p) => ({ id: attr(p, 'id') ?? '', version: attr(p, 'version'), targetFramework: attr(p, 'targetFramework'), line: p.line })).filter((p) => p.id);
}

// web.config or app.config:
//   { services, clientEndpoints, httpModules, httpHandlers, bindingRedirects, targetFrameworks }
export function parseWebConfig(text, file = 'web.config') {
  const root = parseXml(text, file);
  if (root.name !== 'configuration') throw new Error(`${file}: the root element is <${root.name.slice(0, 40)}>, not <configuration>`);
  const names = (list) => list.map((e) => attr(e, 'name') ?? attr(e, 'path') ?? attr(e, 'type') ?? '(no name)');
  const adds = (section) => kids(section, 'add');

  const serviceModel = kids(root, 'system.serviceModel');
  const services = serviceModel.flatMap((sm) => kids(kid(sm, 'services'), 'service').map((s) => attr(s, 'name') ?? '(no name)'));
  const clientEndpoints = serviceModel.flatMap((sm) => kids(kid(sm, 'client'), 'endpoint').map((e) => attr(e, 'name') ?? attr(e, 'contract') ?? '(no name)'));

  const web = kids(root, 'system.web');
  const server = kids(root, 'system.webServer');
  const httpModules = [...web.flatMap((w) => names(adds(kid(w, 'httpModules')))), ...server.flatMap((w) => names(adds(kid(w, 'modules'))))];
  const httpHandlers = [...web.flatMap((w) => names(adds(kid(w, 'httpHandlers')))), ...server.flatMap((w) => names(adds(kid(w, 'handlers'))))];

  const bindingRedirects = [];
  for (const runtime of kids(root, 'runtime')) {
    for (const binding of kids(runtime, 'assemblyBinding')) {
      for (const dep of kids(binding, 'dependentAssembly')) {
        const identity = kid(dep, 'assemblyIdentity');
        for (const r of kids(dep, 'bindingRedirect')) {
          bindingRedirects.push({ name: identity ? attr(identity, 'name') ?? '(no name)' : '(no name)', oldVersion: attr(r, 'oldVersion'), newVersion: attr(r, 'newVersion'), line: r.line });
        }
      }
    }
  }

  const targetFrameworks = [];
  for (const w of web) {
    for (const [section, key] of [['compilation', 'targetFramework'], ['httpRuntime', 'targetFramework']]) {
      const v = attr(kid(w, section) ?? { attrs: {} }, key);
      if (v) targetFrameworks.push({ where: `system.web/${section}`, value: v });
    }
  }
  for (const startup of kids(root, 'startup')) {
    for (const s of kids(startup, 'supportedRuntime')) {
      const v = attr(s, 'sku') ?? attr(s, 'version');
      if (v) targetFrameworks.push({ where: 'startup/supportedRuntime', value: v });
    }
  }

  return {
    serviceModel: serviceModel.length > 0,
    services,
    clientEndpoints,
    httpModules: [...new Set(httpModules)],
    httpHandlers: [...new Set(httpHandlers)],
    bindingRedirects,
    targetFrameworks
  };
}
