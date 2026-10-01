import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProject, frameworkOf, guessKind, nameMatches, PROJECT_TYPES, LANGUAGES, FRAMEWORK_ONLY, WINDOWS_ONLY } from '../src/index.js';
import { oldStyle, sdkStyle, MSBUILD_NS } from './helpers.js';

test('an old-style project: namespace, ToolsVersion, TargetFrameworkVersion, references without version details', () => {
  const text = oldStyle({
    version: 'v4.7.2',
    guids: `{${PROJECT_TYPES.webApplication}};{fae04ec0-301f-11d3-bf4b-00c04f79efbc}`,
    refs: ['System.Web', 'Example.Json, Version=12.0.0.0, Culture=neutral, PublicKeyToken=null'],
    projectRefs: ['..\\Orders.Core\\Orders.Core.csproj']
  });
  assert.ok(text.includes(`xmlns="${MSBUILD_NS}"`));
  const p = parseProject(text, 'src/Orders.Web/Orders.Web.csproj');
  assert.deepEqual([p.name, p.language, p.style, p.sdk, p.toolsVersion, p.outputType], ['Orders.Web', 'C#', 'old-style', null, '15.0', 'Library']);
  assert.deepEqual(p.targets, [{ moniker: 'v4.7.2', family: 'framework', version: '4.7.2', platform: null }]);
  assert.deepEqual(p.references, ['System.Web', 'Example.Json']);
  assert.deepEqual(p.projectReferences, ['../Orders.Core/Orders.Core.csproj']);
  assert.deepEqual(p.projectTypeGuids, [PROJECT_TYPES.webApplication, 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC']);
  assert.deepEqual(p.notes, []);
});

test('SDK style is found from the Sdk attribute, an <Sdk> element or an <Import Sdk>', () => {
  assert.equal(parseProject(sdkStyle({ sdk: 'Microsoft.NET.Sdk.Web' }), 'a.csproj').sdk, 'Microsoft.NET.Sdk.Web');
  const child = parseProject('<Project><Sdk Name="Microsoft.NET.Sdk" /><PropertyGroup><TargetFramework>net6.0</TargetFramework></PropertyGroup></Project>', 'b.vbproj');
  assert.deepEqual([child.style, child.sdk, child.language], ['sdk', 'Microsoft.NET.Sdk', 'VB.NET']);
  const imported = parseProject('<Project><Import Project="Sdk.props" Sdk="Microsoft.NET.Sdk" /><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><Import Project="Sdk.targets" Sdk="Microsoft.NET.Sdk" /></Project>', 'c.fsproj');
  assert.deepEqual([imported.style, imported.language], ['sdk', 'F#']);
  assert.equal(LANGUAGES['.csproj'], 'C#');
});

test('multi-targeting: TargetFrameworks gives every target, and monikers are classified', () => {
  const p = parseProject(sdkStyle({ target: 'net48;netstandard2.0; net8.0-windows ' }), 'multi.csproj');
  assert.deepEqual(p.targets.map((t) => [t.moniker, t.family, t.version, t.platform]), [
    ['net48', 'framework', '4.8', null], ['netstandard2.0', 'netstandard', '2.0', null], ['net8.0-windows', 'modern', '8.0', 'windows']
  ]);
  const cases = { net472: ['framework', '4.7.2'], net481: ['framework', '4.8.1'], net35: ['framework', '3.5'], 'v4.0': ['framework', '4.0'], 'netcoreapp3.1': ['modern', '3.1'], 'net10.0': ['modern', '10.0'], 'netstandard1.6': ['netstandard', '1.6'], net5: ['unknown', null], 'uap10.0': ['unknown', null] };
  for (const [m, [family, version]] of Object.entries(cases)) assert.deepEqual([frameworkOf(m).family, frameworkOf(m).version], [family, version], m);
});

test('properties: the last unconditional value wins, a conditional one only fills a gap, computed values are named', () => {
  const p = parseProject(`<Project ToolsVersion="4.0">
  <PropertyGroup><TargetFrameworkVersion>v4.5</TargetFrameworkVersion><OutputType>Exe</OutputType></PropertyGroup>
  <PropertyGroup Condition="'$(Configuration)' == 'Debug'"><OutputType>WinExe</OutputType><AssemblyName>Debug.Name</AssemblyName></PropertyGroup>
  <PropertyGroup><TargetFrameworkVersion>v4.6.1</TargetFrameworkVersion></PropertyGroup>
  <Target Name="X"><PropertyGroup><TargetFrameworkVersion>v2.0</TargetFrameworkVersion></PropertyGroup></Target>
</Project>`, 'p.csproj');
  assert.deepEqual([p.targets[0].moniker, p.outputType, p.assemblyName], ['v4.6.1', 'Exe', 'Debug.Name']);
  const computed = parseProject(sdkStyle({ target: '$(SharedTarget)' }), 'q.csproj');
  assert.deepEqual(computed.targets, []);
  assert.ok(computed.notes.some((n) => /TargetFramework is "\$\(SharedTarget\)", which MSBuild computes/.test(n)));
  assert.ok(computed.notes.some((n) => /Directory\.Build\.props, which is not read/.test(n)));
  const conditional = parseProject('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup Condition="true"><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>', 'r.csproj');
  assert.ok(conditional.notes.includes('TargetFramework is set only under a Condition; the first value was used'));
});

test('package, project and framework references, with versions in attributes or elements', () => {
  const p = parseProject(sdkStyle({
    items: '<PackageReference Include="Example.A" Version="1.2.3" /><PackageReference Include="Example.B"><Version>4.5.6</Version></PackageReference><PackageReference Update="Example.C" Version="9" /><ProjectReference Include="..\\x\\X.csproj;..\\y\\Y.csproj" /><FrameworkReference Include="Microsoft.AspNetCore.App" />',
    props: '<UseWPF>true</UseWPF><UseWindowsForms>True</UseWindowsForms><IsTestProject>false</IsTestProject>'
  }), 's.csproj');
  assert.deepEqual(p.packageReferences, [{ id: 'Example.A', version: '1.2.3' }, { id: 'Example.B', version: '4.5.6' }]);
  assert.deepEqual(p.projectReferences, ['../x/X.csproj', '../y/Y.csproj']);
  assert.deepEqual(p.frameworkReferences, ['Microsoft.AspNetCore.App']);
  assert.deepEqual([p.useWpf, p.useWindowsForms, p.isTestProject], [true, true, false]);
});

test('a file that is not an MSBuild project, or not safe XML, is refused', () => {
  assert.throws(() => parseProject('<packages />', 'x.csproj'), /x\.csproj: the root element is <packages>, not <Project>/);
  assert.throws(() => parseProject('<!DOCTYPE p [<!ENTITY e "x">]><Project>&e;</Project>', 'y.csproj'), /y\.csproj: line 1: a DOCTYPE declaration is refused/);
});

test('project kinds are guessed from the SDK, type ids, references, packages and files', () => {
  const old = (o) => parseProject(oldStyle(o), 'k.csproj');
  const cases = [
    [old({ refs: ['System.Web'] }), { webForms: 2 }, [], true, 'Web Forms'],
    [old({ refs: ['System.Web', 'System.Web.Mvc'] }), { razor: 4 }, [], true, 'MVC'],
    [old({ guids: `{${PROJECT_TYPES.mvc[2]}}` }), {}, [], false, 'MVC'],
    [old({ refs: ['System.Web'] }), {}, ['Microsoft.AspNet.WebApi.Core'], true, 'Web API'],
    [old({ refs: ['System.Web', 'System.Web.Services'] }), { asmx: 1 }, [], true, 'ASMX web service'],
    [old({ guids: `{${PROJECT_TYPES.wcf}}` }), {}, [], false, 'WCF service'],
    [old({ refs: ['System.Web'] }), { wcf: 1 }, [], true, 'WCF service'],
    [old({ guids: `{${PROJECT_TYPES.webApplication}}` }), {}, [], true, 'web application'],
    [old({ output: 'Exe', refs: ['System.ServiceProcess'] }), {}, [], false, 'Windows service'],
    [old({ output: 'WinExe', refs: ['PresentationFramework', 'WindowsBase'] }), {}, [], false, 'desktop (WPF)'],
    [old({ output: 'WinExe', refs: ['System.Windows.Forms'] }), {}, [], false, 'desktop (WinForms)'],
    [old({ output: 'Exe' }), {}, [], false, 'console'],
    [old({ output: 'WinExe' }), {}, [], false, 'desktop'],
    [old({}), {}, [], false, 'class library'],
    [old({}), {}, ['NUnit'], false, 'test'],
    [parseProject(sdkStyle({ sdk: 'Microsoft.NET.Sdk.Web' }), 'w.csproj'), {}, [], false, 'ASP.NET Core web'],
    [parseProject(sdkStyle({ props: '<UseWindowsForms>true</UseWindowsForms>' }), 'f.csproj'), {}, [], false, 'desktop (WinForms)'],
    [parseProject(sdkStyle({ items: '<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0" />' }), 't.csproj'), {}, [], false, 'test']
  ];
  for (const [project, files, packages, web, kind] of cases) assert.equal(guessKind(project, files, packages, web), kind, kind);
});

test('assembly name lists match exact names and names below a ".*" entry, ignoring case', () => {
  assert.ok(nameMatches(FRAMEWORK_ONLY, 'system.web'));
  assert.ok(nameMatches(FRAMEWORK_ONLY, 'System.Web.Extensions'));
  assert.ok(!nameMatches(FRAMEWORK_ONLY, 'System.WebSockets'));
  assert.ok(nameMatches(WINDOWS_ONLY, 'System.Drawing.Common'));
  assert.ok(nameMatches(WINDOWS_ONLY, 'Microsoft.Win32.Registry'));
  assert.ok(!nameMatches(WINDOWS_ONLY, 'System.Data'));
});
