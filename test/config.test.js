import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePackagesConfig, parseWebConfig } from '../src/index.js';

test('packages.config: every package with its version and target framework', () => {
  const list = parsePackagesConfig('<?xml version="1.0"?>\n<packages>\n  <package id="Example.Json" version="12.0.3" targetFramework="net472" />\n  <package id="Example.Mail" version="2.1.0" />\n  <package version="1.0" />\n</packages>', 'packages.config');
  assert.deepEqual(list, [
    { id: 'Example.Json', version: '12.0.3', targetFramework: 'net472', line: 3 },
    { id: 'Example.Mail', version: '2.1.0', targetFramework: null, line: 4 }
  ]);
  assert.throws(() => parsePackagesConfig('<configuration />', 'p/packages.config'), /p\/packages\.config: the root element is <configuration>, not <packages>/);
});

test('web.config: modules and handlers from both sections, services, client endpoints, redirects and targets', () => {
  const c = parseWebConfig(`<configuration>
  <connectionStrings><add name="Main" connectionString="Server=db.example.test;Password=placeholder" /></connectionStrings>
  <system.web>
    <compilation debug="true" targetFramework="4.6.1" />
    <httpRuntime targetFramework="4.6.1" />
    <httpModules><add name="Audit" type="A, A" /><add name="Gzip" type="G, G" /></httpModules>
    <httpHandlers><add verb="*" path="img.axd" type="Img, Img" /></httpHandlers>
  </system.web>
  <system.webServer>
    <modules><add name="Audit" type="A, A" /><remove name="Session" /></modules>
    <handlers><add name="Report" path="r.axd" verb="GET" type="R, R" /></handlers>
  </system.webServer>
  <system.serviceModel>
    <services><service name="Orders.Svc"><endpoint contract="IOrders" /></service><service name="Billing.Svc" /></services>
    <client><endpoint name="Stock" contract="IStock" /><endpoint contract="IMail" /></client>
  </system.serviceModel>
  <runtime>
    <assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1">
      <dependentAssembly><assemblyIdentity name="Example.Json" /><bindingRedirect oldVersion="0.0.0.0-12.0.0.0" newVersion="12.0.0.0" /></dependentAssembly>
    </assemblyBinding>
  </runtime>
</configuration>`, 'Web.config');
  assert.deepEqual(c.httpModules, ['Audit', 'Gzip']);
  assert.deepEqual(c.httpHandlers, ['img.axd', 'Report']);
  assert.deepEqual(c.services, ['Orders.Svc', 'Billing.Svc']);
  assert.deepEqual(c.clientEndpoints, ['Stock', 'IMail']);
  assert.deepEqual(c.bindingRedirects, [{ name: 'Example.Json', oldVersion: '0.0.0.0-12.0.0.0', newVersion: '12.0.0.0', line: 19 }]);
  assert.deepEqual(c.targetFrameworks, [{ where: 'system.web/compilation', value: '4.6.1' }, { where: 'system.web/httpRuntime', value: '4.6.1' }]);
  assert.equal(c.serviceModel, true);
  assert.ok(!JSON.stringify(c).includes('placeholder'));
});

test('app.config: supportedRuntime is read; section names are compared exactly; other roots are refused', () => {
  const c = parseWebConfig('<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup><System.Web><httpModules><add name="X" /></httpModules></System.Web></configuration>', 'App.config');
  assert.deepEqual(c.targetFrameworks, [{ where: 'startup/supportedRuntime', value: '.NETFramework,Version=v4.8' }]);
  assert.deepEqual([c.httpModules, c.httpHandlers, c.services, c.clientEndpoints, c.bindingRedirects, c.serviceModel], [[], [], [], [], [], false]);
  assert.throws(() => parseWebConfig('<settings />', 'App.config'), /not <configuration>/);
});
