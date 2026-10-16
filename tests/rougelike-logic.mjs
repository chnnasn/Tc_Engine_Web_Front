// Native checks against the actual sample source, without starting a renderer.
// Opt-in: node tests/rougelike-logic.mjs (requires .NET 10 and the Tc managed DLL).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const engine = resolve(root, '.engine')
const managed = resolve(process.env.TOMCAT_MANAGED_DIR || join(engine, 'upgrade-managed'), 'TomCat.Managed.dll')
if (!existsSync(managed)) throw new Error(`Missing Tc managed reference: ${managed}`)
mkdirSync(engine, { recursive: true })
const work = mkdtempSync(join(engine, 'rougelike-logic-'))
const xml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const scripts = join(root, 'samples/rougelike/Assets/Scripts')
const sourceItems = readdirSync(scripts).filter(name => name.endsWith('.cs'))
  .map(name => `<Compile Include="${xml(join(scripts, name))}" Link="${xml(name)}" />`).join('\n')
writeFileSync(join(work, 'Checks.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>disable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup>
  <ItemGroup><Reference Include="TomCat.Managed"><HintPath>${xml(managed)}</HintPath></Reference>${sourceItems}</ItemGroup>
</Project>`)
writeFileSync(join(work, 'NuGet.Config'), '<configuration><packageSources><clear /></packageSources></configuration>')
writeFileSync(join(work, 'Program.cs'), String.raw`
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using TomCat;
using TomCatGame;

static class Program
{
    static void Check(bool condition, string name)
    {
        if (!condition) throw new Exception(name);
    }

    static void Main()
    {
        // These expectations are the original Godot project's authored tables.
        int[] counts = { 5, 5, 10, 5, 10, 20, 20, 60, 60, 60 };
        int[] health = { 1, 2, 2, 4, 5, 3, 5, 1, 3, 5 };
        Check(RougelikeRules.WaveCounts.Length == 10 && RougelikeRules.WaveHealth.Length == 10, "ten waves");
        for (int i = 0; i < 10; i++) Check(RougelikeRules.WaveCounts[i] == counts[i] && RougelikeRules.WaveHealth[i] == health[i], "wave " + (i + 1));
        Check(RougelikeRules.Names.Length == 21 && RougelikeRules.BaseAmounts.Length == 21, "all upgrades");

        for (int mask = 0; mask < 8; mask++)
        {
            bool slow = (mask & 1) != 0, hole = (mask & 2) != 0, charge = (mask & 4) != 0;
            var expected = new List<UpgradeStat>();
            expected.AddRange(slow ? new[] { UpgradeStat.SlowDrain, UpgradeStat.SlowDepth } : new[] { UpgradeStat.UnlockSlow });
            expected.AddRange(hole ? new[] { UpgradeStat.BlackHoleCost, UpgradeStat.BlackHoleDuration, UpgradeStat.BlackHoleRadius } : new[] { UpgradeStat.UnlockBlackHole });
            expected.AddRange(charge ? new[] { UpgradeStat.ChargeFaster, UpgradeStat.ChargeRange, UpgradeStat.ChargeWidth } : new[] { UpgradeStat.UnlockCharge });
            for (int i = 0; i < expected.Count; i++)
            {
                var draw = RougelikeRules.Roll(new ScriptedRandom(new[] { 0d }, i, expected.Count), 1, slow, hole, charge);
                Check(draw.Stat == expected[i], "unlock-dependent special pool");
                int rarity = draw.Stat >= UpgradeStat.UnlockCharge ? 7 : draw.Stat >= UpgradeStat.UnlockBlackHole ? 6 : 5;
                Check(draw.Rarity == rarity && draw.Amount == RougelikeRules.BaseAmounts[(int)draw.Stat], "special family and amount");
            }
            double threshold = mask == 0 ? .10 : .22;
            var before = RougelikeRules.Roll(new ScriptedRandom(new[] { threshold - .000001 }, 0, expected.Count), 1, slow, hole, charge);
            var at = RougelikeRules.Roll(new ScriptedRandom(new[] { threshold, 0d }, 0, 10), 1, slow, hole, charge);
            Check(before.Rarity >= 5 && at.Rarity < 5, "special probability boundary");
        }

        foreach (int wave in new[] { -10, 1, 5, 10, 99 })
        {
            double t = Math.Max(0, Math.Min(1, (wave - 1) / 9d));
            double[] early = { 62, 25, 9, 3, 1 }, late = { 6, 20, 30, 28, 16 };
            float[] multipliers = { 1, 1.7f, 2.8f, 4.4f, 7 };
            double previous = 0;
            for (int rarity = 0; rarity < 5; rarity++)
            {
                double weight = early[rarity] + (late[rarity] - early[rarity]) * t;
                var c = RougelikeRules.Roll(new ScriptedRandom(new[] { .99, (previous + weight * .5) / 100 }, 2, 10), wave, false, false, false);
                Check(c.Rarity == rarity && c.Stat == UpgradeStat.MoveSpeed, "rarity interpolation and clamping");
                Check(Math.Abs(c.Amount - 26 * multipliers[rarity]) < .00001, "rarity amount multiplier");
                previous += weight;
            }
        }

        CultureInfo.CurrentCulture = new CultureInfo("fr-FR");
        Check(RougelikeRules.Describe(new(UpgradeStat.AttackCooldown, 0, -.006f)) == "-0.006 秒", "invariant decimal description");
        Check(RougelikeRules.Describe(new(UpgradeStat.BlackHoleDuration, 6, .8f)) == "+0.8 秒", "signed duration description");
        Check(RougelikeRules.Describe(new(UpgradeStat.UnlockCharge, 7, 0)).Contains("松手"), "unlock controls description");

        // Invoke the production application method. Awake/World/rendering never
        // run; no TomCat native calls or test substitute for upgrade logic.
        const BindingFlags instance = BindingFlags.Instance | BindingFlags.NonPublic;
        var apply = typeof(RougelikeGame).GetMethod("Apply", instance)!;
        void Set(RougelikeGame game, string name, object value) => typeof(RougelikeGame).GetField(name, instance)!.SetValue(game, value);
        float Number(RougelikeGame game, string name) => Convert.ToSingle(typeof(RougelikeGame).GetField(name, instance)!.GetValue(game), CultureInfo.InvariantCulture);
        void Value(RougelikeGame game, string name, float expected) => Check(Math.Abs(Number(game, name) - expected) < .0001f, "apply " + name + ": " + Number(game, name) + " expected " + expected);
        void ApplyTo(RougelikeGame game, UpgradeStat stat, float amount) => apply.Invoke(game, new object[] { new UpgradeChoice(stat, 0, amount) });
        var maxHp = new RougelikeGame(); Set(maxHp, "health", 3);
        ApplyTo(maxHp, UpgradeStat.MaxHealth, 2.5f); Value(maxHp, "maxHealth", 13); Value(maxHp, "health", 6);
        var heal = new RougelikeGame(); Set(heal, "health", 3);
        ApplyTo(heal, UpgradeStat.Heal, 2.5f); Value(heal, "health", 6); Value(heal, "maxHealth", 10);
        ApplyTo(heal, UpgradeStat.Heal, 100); Value(heal, "health", 10);
        var maxEnergy = new RougelikeGame(); Set(maxEnergy, "energy", 70f);
        ApplyTo(maxEnergy, UpgradeStat.MaxEnergy, 25); Value(maxEnergy, "maxEnergy", 125); Value(maxEnergy, "energy", 95);
        var range = new RougelikeGame(); ApplyTo(range, UpgradeStat.ChargeRange, 90);
        Value(range, "chargeMaxRange", 650); Value(range, "chargeMinRange", 162.5f);
        (UpgradeStat stat, string field, float amount, float expected)[] simple = {
            (UpgradeStat.MoveSpeed, "speed", 26, 526),
            (UpgradeStat.AttackCooldown, "attackCooldown", -.006f, .044f),
            (UpgradeStat.SlashRadius, "slashRadius", 7, 72),
            (UpgradeStat.SlashSpan, "slashSpan", 10, 250),
            (UpgradeStat.Invulnerability, "invulnerability", .05f, .7f),
            (UpgradeStat.EnergyRegen, "regen", 8, 33),
            (UpgradeStat.AttackCost, "attackCost", -1, 9),
            (UpgradeStat.SlowDrain, "slowDrain", -4, 40),
            (UpgradeStat.SlowDepth, "slowScale", -.03f, .22f),
            (UpgradeStat.BlackHoleCost, "holeCost", -6, 24),
            (UpgradeStat.BlackHoleDuration, "holeDuration", .8f, 3.8f),
            (UpgradeStat.BlackHoleRadius, "holeRadius", 45, 265),
            (UpgradeStat.ChargeFaster, "chargeMaxTime", -.12f, .98f),
            (UpgradeStat.ChargeWidth, "chargeWidth", 8, 42),
        };
        foreach (var entry in simple) {
            var game = new RougelikeGame(); ApplyTo(game, entry.stat, entry.amount); Value(game, entry.field, entry.expected);
        }
        foreach (var entry in new[] { (UpgradeStat.UnlockSlow, "slowUnlocked"), (UpgradeStat.UnlockBlackHole, "holeUnlocked"), (UpgradeStat.UnlockCharge, "chargeUnlocked") }) {
            var game = new RougelikeGame(); ApplyTo(game, entry.Item1, 0);
            Check((bool)typeof(RougelikeGame).GetField(entry.Item2, instance)!.GetValue(game)!, "apply " + entry.Item1);
        }
        (UpgradeStat stat, string field, float amount, float bound)[] limits = {
            (UpgradeStat.AttackCooldown, "attackCooldown", -100, .01f),
            (UpgradeStat.SlashSpan, "slashSpan", 1000, 360),
            (UpgradeStat.AttackCost, "attackCost", -100, 1),
            (UpgradeStat.SlowDrain, "slowDrain", -100, 2),
            (UpgradeStat.SlowDepth, "slowScale", -100, .05f),
            (UpgradeStat.BlackHoleCost, "holeCost", -100, 5),
            (UpgradeStat.ChargeFaster, "chargeMaxTime", -100, .15f),
        };
        foreach (var entry in limits) {
            var game = new RougelikeGame(); ApplyTo(game, entry.stat, entry.amount); Value(game, entry.field, entry.bound);
            ApplyTo(game, entry.stat, entry.amount); Value(game, entry.field, entry.bound);
        }

        // A sliced reroll waits .05 s. A keyboard choice during that delay must
        // cancel it; a stale reroll dispatched after leaving Upgrade must also
        // be rejected. Exercise the real selection guard and real dispatcher.
        var phaseType = typeof(RougelikeGame).GetNestedType("Phase", BindingFlags.NonPublic)!;
        var prepareChoice = typeof(RougelikeGame).GetMethod("PrepareChoice", instance)!;
        var performAction = typeof(RougelikeGame).GetMethod("PerformAction", instance)!;
        var selecting = new RougelikeGame();
        Set(selecting, "phase", Enum.Parse(phaseType, "Upgrade"));
        Set(selecting, "choices", new[] { new UpgradeChoice(UpgradeStat.MoveSpeed, 0, 26), new UpgradeChoice(UpgradeStat.Heal, 0, 1), new UpgradeChoice(UpgradeStat.MaxEnergy, 0, 25) });
        Set(selecting, "pendingAction", 20); Set(selecting, "actionDelay", .04f);
        Check((bool)prepareChoice.Invoke(selecting, null)!, "valid choice accepted");
        Value(selecting, "pendingAction", -1); Value(selecting, "actionDelay", 0); Value(selecting, "rerolls", 3);
        var noCards = new RougelikeGame(); Set(noCards, "phase", Enum.Parse(phaseType, "Upgrade"));
        Check(!(bool)prepareChoice.Invoke(noCards, null)!, "choice without three cards rejected");
        foreach (string phaseName in new[] { "Menu", "Playing", "Dying", "Dead", "Clear" }) {
            var game = new RougelikeGame(); var expectedPhase = Enum.Parse(phaseType, phaseName);
            Set(game, "phase", expectedPhase); Set(game, "pendingAction", 20); Set(game, "wave", 4);
            performAction.Invoke(game, null);
            Value(game, "pendingAction", -1); Value(game, "rerolls", 3); Value(game, "wave", 4);
            Check(expectedPhase.Equals(typeof(RougelikeGame).GetField("phase", instance)!.GetValue(game)), "stale reroll cannot reopen Upgrade from " + phaseName);
        }
        var noRerolls = new RougelikeGame(); Set(noRerolls, "phase", Enum.Parse(phaseType, "Upgrade"));
        Set(noRerolls, "rerolls", 0); Set(noRerolls, "pendingAction", 20);
        performAction.Invoke(noRerolls, null); Value(noRerolls, "rerolls", 0); Value(noRerolls, "pendingAction", -1);

        // Exercise the production circle/polygon predicate, not a copied implementation.
        var flags = BindingFlags.NonPublic | BindingFlags.Static;
        var hit = typeof(RougelikeGame).GetMethod("CirclePolygon", flags)!;
        var ease = typeof(RougelikeGame).GetMethod("EaseQuint", flags)!;
        var rotate = typeof(RougelikeGame).GetMethod("Rotate", flags)!;
        Vector2[] quarterRing = { new(100, 0), new(0, 100), new(0, 60), new(60, 0) };
        bool Touches(float x, float y, float radius) => (bool)hit.Invoke(null, new object[] { new Vector2(x, y), radius, quarterRing })!;
        Check(!Touches(0, 0, 25), "ring inner hole");
        Check(Touches(50, 30, 1), "current swept region");
        Check(!Touches(-50, 30, 25), "not-yet-swept side");
        Check(Touches(105, 0, 6), "circle edge contact");
        Check(!Touches(112, 0, 10), "outside reach");
        Check((float)ease.Invoke(null, new object[] { 0f })! == 0 && (float)ease.Invoke(null, new object[] { 1f })! == 1, "sweep endpoints");
        Check(Math.Abs((float)ease.Invoke(null, new object[] { .5f })! - .96875f) < .00001, "quint sweep timing");
        var turned = (Vector2)rotate.Invoke(null, new object[] { new Vector2(100, 0), MathF.PI / 2 })!;
        Check(Math.Abs(turned.X) < .001 && Math.Abs(turned.Y - 100) < .001, "rotated facing");
        Console.WriteLine("PASS: authored waves, 8 special pools, chance boundaries, rarity progression, descriptions, all 21 upgrade applications, 7 repeated clamps, stale-reroll race guards and production slash geometry.");
        Console.WriteLine("Scope: native pure logic; does not prove browser rendering, ten-wave survival, skill input, or audio.");
    }
}

sealed class ScriptedRandom : Random
{
    readonly Queue<double> doubles;
    readonly int selected, expectedMax;
    public ScriptedRandom(double[] values, int selected, int expectedMax)
    {
        doubles = new Queue<double>(values); this.selected = selected; this.expectedMax = expectedMax;
    }
    public override double NextDouble() => doubles.Dequeue();
    public override int Next(int maxValue)
    {
        if (maxValue != expectedMax) throw new Exception("Unexpected lottery pool size: " + maxValue);
        return selected;
    }
}
`)
const env = {
  ...process.env, DOTNET_CLI_HOME: join(work, '.dotnet'), DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  NUGET_PACKAGES: join(work, '.nuget/packages'), NUGET_HTTP_CACHE_PATH: join(work, '.nuget/http'),
  NUGET_PLUGINS_CACHE_PATH: join(work, '.nuget/plugins'),
}
try {
  for (const args of [
    ['restore', join(work, 'Checks.csproj'), '--configfile', join(work, 'NuGet.Config'), '--verbosity', 'quiet'],
    ['run', '--project', join(work, 'Checks.csproj'), '--no-restore', '--nologo'],
  ]) {
    const result = spawnSync(process.env.TOMCAT_DOTNET || 'dotnet', args, { cwd: root, env, stdio: 'inherit' })
    if (result.status !== 0) throw new Error(`Native Rougelike checks failed: ${result.error?.message || result.status}`)
  }
} finally {
  const target = resolve(work)
  if (!target.startsWith(engine + sep) || !target.split(sep).at(-1).startsWith('rougelike-logic-')) throw new Error('Unexpected temporary test directory')
  rmSync(target, { recursive: true, force: true })
}
