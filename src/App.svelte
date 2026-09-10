<!--
  App shell. No router library: a single `screen` value decides what's
  showing, mirrored into the browser history so the iOS edge-swipe, the
  browser back button, and the on-screen back buttons all do the same thing.
  `{#key}` remounts a screen when its id changes so its queries re-run.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import TabBar, { type Tab } from "./components/TabBar.svelte";
  import Block from "./screens/Block.svelte";
  import Calendar from "./screens/Calendar.svelte";
  import Cardio from "./screens/Cardio.svelte";
  import Home from "./screens/Home.svelte";
  import MesocycleBuilder from "./screens/MesocycleBuilder.svelte";
  import Session from "./screens/Session.svelte";
  import Settings from "./screens/Settings.svelte";

  type Screen =
    | { name: "calendar" }
    | { name: "blocks" }
    | { name: "builder" }
    | { name: "cardio" }
    | { name: "settings" }
    | { name: "block"; mesocycleId: number }
    | { name: "session"; sessionId: number; mesocycleId: number };

  const HOME: Screen = { name: "calendar" };
  let screen = $state<Screen>(HOME);

  /** Forward navigation: push a history entry so "back" returns here. */
  function go(next: Screen, opts: { replace?: boolean } = {}) {
    const depth = (history.state?.depth ?? 0) + (opts.replace ? 0 : 1);
    history[opts.replace ? "replaceState" : "pushState"]({ screen: next, depth }, "");
    screen = next;
  }

  /**
   * Back navigation. Unwind history when there's app history to unwind;
   * otherwise (the app was opened straight onto a deep screen, or history
   * was lost) jump home without pushing.
   */
  function back() {
    if ((history.state?.depth ?? 0) > 0) history.back();
    else go(HOME, { replace: true });
  }

  const activeTab = $derived<Tab>(
    screen.name === "settings" ? "settings"
      : screen.name === "cardio" ? "cardio"
      : screen.name === "calendar" ? "calendar"
      : "blocks"
  );

  function selectTab(tab: Tab) {
    const target: Screen = tab === "calendar" ? HOME : tab === "blocks" ? { name: "blocks" } : tab === "cardio" ? { name: "cardio" } : { name: "settings" };
    if (screen.name !== target.name) go(target);
  }

  onMount(() => {
    history.replaceState({ screen: HOME, depth: 0 }, "");
    const onPop = (e: PopStateEvent) => {
      screen = (e.state?.screen as Screen | undefined) ?? HOME;
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  });
</script>

{#if screen.name === "calendar"}
  <Calendar
    onOpenSession={(sessionId, mesocycleId) => go({ name: "session", sessionId, mesocycleId })}
    onOpenBlock={(mesocycleId) => go({ name: "block", mesocycleId })}
  />
{:else if screen.name === "blocks"}
  <Home onNewBlock={() => go({ name: "builder" })} onOpenBlock={(mesocycleId) => go({ name: "block", mesocycleId })} />
{:else if screen.name === "settings"}
  <Settings />
{:else if screen.name === "cardio"}
  <Cardio />
{:else if screen.name === "builder"}
  <!-- After saving, replace the builder entry so back goes to the list, not to an empty form. -->
  <MesocycleBuilder onSaved={(mesocycleId) => go({ name: "block", mesocycleId }, { replace: true })} onCancel={back} />
{:else if screen.name === "block"}
  {#key screen.mesocycleId}
    {@const mesocycleId = screen.mesocycleId}
    <Block {mesocycleId} onOpenSession={(sessionId) => go({ name: "session", sessionId, mesocycleId })} onBack={back} />
  {/key}
{:else if screen.name === "session"}
  {#key screen.sessionId}
    <Session sessionId={screen.sessionId} onBack={back} />
  {/key}
{/if}

<TabBar active={activeTab} onselect={selectTab} />
