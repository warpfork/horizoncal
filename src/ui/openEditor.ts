import {
	TFile,
	WorkspaceLeaf
} from "obsidian";
import { HCEvent } from "src/data/data";
import HorizonCalPlugin from "src/main";

// Opens an event in an editor, or focuses it if already open.
// 
// This attempts to find a "least surprising" place to open the editor,
// while also trying to keep the calendar in view (if appropriate, e.g. if on desktop mode).
//
// So we do a couple searches to select that the least-surprsing place:
//
// - If there's an existing editor pane open to that file: just focus it.
// - If we have to open one: *prefer to do it as a tab next to anything else open in the horizoncal dir*.
// - If no editors are open to that zone at all, we're going to create a new split,
//    so that they end up visually near the calendar, and don't cause the calendar to totally disappear.
//    (On mobile, this has a much more limited effect: the tabs drawer gets a divider line in it.  Views are still fullscreen.)
//
// The whole obsidian app is taken as a parameter (implicltly, via plugin) for simplicity,
// but the actual pieces needed are the vault and the workspace.
// The plugin is used purely for the settings object,
// and that only to see where our prefix path is,
// as that's our heuristic for editors that are neighborly.
export async function openEventInEditor(plugin: HorizonCalPlugin, target: HCEvent | TFile | string): Promise<Error | undefined> {
	let { workspace, vault } = plugin.app;

	// Reduce target to a string,
	//  because we need one of those to search across existing editors.
	let targetString: string;
	if (target instanceof TFile) {
		targetString = target.path
	} else if (target instanceof HCEvent) {
		if (!target.loadedFrom) {
			return new Error("cannot open editor for an HCEvent with no associated file path")
		}
		targetString = target.loadedFrom
	} else {
		targetString = target
	}

	// Search for existing editors that are exact matches,
	// and keep a finger on one that looks neighborly but isn't an exact match.
	// Shift focus and return early upon finding an exact match.
	let sameZone: WorkspaceLeaf | undefined;
	let exactMatch: boolean = false
	workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
		// We can't abort the iteration early if we found an exact match, so just exit as fast as possible.
		if (exactMatch) { return }

		const viewState = leaf.getViewState()

		// Only interested in markdown editor views.
		if (viewState.type !== 'markdown') return;

		// If we find an exact match?  Great, focus it, and we're done.
		if (viewState.state?.file == targetString) {
			exactMatch = true
			workspace.setActiveLeaf(leaf, { focus: true })
			return
		}

		// If it's... close?  Keep a finger on it; we might use it.
		//  Finding one of these doesn't shortcut out the rest of the iteration,
		//   so it's the last one found that takes effect.
		if (viewState.state?.file.startsWith(plugin.settings.prefixPath)) {
			sameZone = leaf
		}
	})
	if (exactMatch) {
		// If we found an exact match window, focusing it already happened,
		//  and we need to do none of the further shenanigans around opening a new leaf.
		return
	}

	// Okay, if we found no exact match... we're opening a new leaf.
	// And maybe, near some existing leaf.  Or, maybe in a new split.
	let targetLeaf: WorkspaceLeaf;
	if (sameZone) {
		// The API for creating new leaves is a little interesting.
		//
		// You can generally only ask the workspace to give you a new leaf relative to existing ones.
		//  - `getLeaf` makes new ones relevant to the active leaf
		//      ... so you have to _set the active leaf_ first if you want to control it;
		//      {PaneType} is functionally the only parameter.
		//  - `duplicateLeaf` offers a little more control --
		//      {orientationLeaf, PaneType, SplitDirection?}.
		//      Of course, it also has an effect of loading up the entire view of that leaf.
		//       So, if it was open as an editor, you get... another one.
		//       Even if all you want to do is immediately navigate away.
		//       (This shows up in the tab's history nav, also!  Not just the first page, but the WHOLE history stack!)
		//      Oh, and 'duplicateLeaf' returns a promise, unlike most of the neighbors which are synchronous.
		//       (I assume that's beacuse spawning a whole view inside it may be async?  Unclear.)
		//      Oh, AND, lol, the leaf parameter isn't actually for where to orient.  It's for what to copy.
		//       This thing still opens relative to the active leaf.  Sheesh.
		//  - `createLeafBySplit` offers slightly different options --
		//      {orientationLeaf, SplitDirection, before?: boolean}
		//       apparently PaneType is defacto hardcoded to 'split' with this one,
		//       but as a consolation prize, you get that 'before' boolean.
		//      Also unlike `duplicateLeaf`, it literally offers like, any control at all over where things go.
		// And there's a couple more deprecated options like "splitActiveLeaf", but no relevance of those.
		// Also, "createLeafInParent" exists, but danged if I can guess how that's meant to be used.
		//
		// So that's quite a jungle of options.  Twisty little passages, all not quite alike.
		//
		// And in all that, _I can't find an option for making new tabs as a sibling of something_...
		// Unless you hack it, but setting active leaf first.  Lordie.
		console.log("creating sibling leaf of", sameZone)
		// targetLeaf = await workspace.duplicateLeaf(sameZone, 'tab') // not at all correct; does not control position, and brings along massive state.
		// targetLeaf = workspace.createLeafBySplit(sameZone) // kinda DTRT but iff you want split; no tab option.
		// Okay.  hacks it is.
		workspace.setActiveLeaf(sameZone)
		targetLeaf = workspace.getLeaf('tab')
	} else {
		// If there are no other relevant leaves already open: we're going to make a new split for you.
		// Since my typical usage is timegrid, ditching vertical space is fine (but losing width would cause a jarring repaint),
		// so we'll use a "horizonal" split (horizonal refers to the line that will appear, apparently).
		targetLeaf = workspace.getLeaf('split', 'horizontal')
	}

	// Lastly, to actually open an edtior, we need a TFile, instead of a string.
	// (This dance seems somewhat silly to me, because it's very TOCTOU, but, whatever.)
	let targetFile: TFile;
	if (target instanceof TFile) {
		targetFile = target
	} else {
		let file = vault.getAbstractFileByPath(targetString)
		if (!file || !(file instanceof TFile)) {
			return new Error(`cannot open editor to path '${targetString}': not a file`)
		}
		targetFile = file
	}

	// Finally!  We can tell our target leaf to become an editor open to the target file.
	await targetLeaf.openFile(targetFile, { active: true });
}
