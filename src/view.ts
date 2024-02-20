import {
	ItemView,
	Menu,
	Modal,
	Setting,
	TFile,
	WorkspaceLeaf
} from 'obsidian';

import {
	Calendar,
	EventDropArg,
	EventInput,
	EventSourceInput
} from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { EventResizeDoneArg } from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import timeGridPlugin from '@fullcalendar/timegrid';

import luxonPlugin, { toLuxonDateTime } from '@fullcalendar/luxon3';

import { getAPI, Literal } from 'obsidian-dataview';


import { HCEvent, HCEventFilePath } from './data';
import HorizonCalPlugin from './main';

export const VIEW_TYPE = "horizoncal-view";

var uniq = 1;

export class HorizonCalView extends ItemView {
	constructor(plugin: HorizonCalPlugin, leaf: WorkspaceLeaf) {
		super(leaf);
		this.plugin = plugin;
		this.uniq = uniq++;
	}

	getViewType() {
		return VIEW_TYPE;
	}
	getIcon(): string {
		return "calendar-glyph";
	}
	getDisplayText() {
		return "Horizon Calendar " + this.uniq;
	}
	public navigation: false; // Don't generally let me click away from this view.

	plugin: HorizonCalPlugin;
	uniq: number; // Not structural.  Using this for sanitycheck during dev.
	viewContentEl: Element; // Reference grabbed during onOpen.
	calUIEl: HTMLElement; // Div created during onOpen to be fullcal's root.
	calUI: Calendar; // Fullcal's primary control object.

	eventSources: EventSourceInput[] = [
		{
			events: function (info, successCallback, failureCallback) {
				//console.log("---- queried for", info.start, "through", info.end);
				// .query({
				// 	start: info.start.valueOf(),
				// 	end: info.end.valueOf()
				// })

				// So about Dataview.
				//
				// Dataview does a lot.  Some of it helpful, some of it... imo, kind of a waste of time.
				// The helpful parts are so numerous they don't bear listing.
				// The less helpful parts:
				//   - Every field in the frontmatter that's got capital letters?  It gets cloned to a downcased one.
				//      -> this makes it confusing to range over the set because it's got duplicates!
				//      -> it's also a waste of memory!  Big sigh.
				//   - Anything that looks like a date got parsed to a Luxon DateTime object already!
				//      -> cool for the purpose of dv queries themselves...
				//      -> it's a little wasteful for our purposes, because we're just gonna turn around and integrate with another API that doesn't use that format.
				//      -> and when I said "date"?  I mean with YYYY-MM-DD.  It doesn't detect or do anything with HH:MM.
				//   - DV has gathered outlinks, inlinks, tasks, lists...
				//      -> the latter two don't really matter much in practice (event file contents are pretty short), but it's unnecessary work.
				//      -> inlinks required DV to index and parse *how much??* of my vault?  Very unnecessary work.
				//
				// The way to safely ignore all this is to peep `.file.frontmatter`.  That has the originals.
				// And I think someday we might have a compelling argument for making our own simpler query system that does _less_.
				// (Or find some flags to DV that ask it to Do Less; that'd be great.)
				// 
				type DVT_Record = Record<string, Literal> & { file: TFile };
				const dv = getAPI();
				const pages = dv.pages('"sys/horizoncal"')
					// TODO need this to be as un-eager as possible.
					// I think `.pages` is already gonna load and parse all those, so... no, bad.
					// "Dataview indexes its sources internally" states their docs, but I'm going to hope it doesn't do so proactively either.
					//
					// might be strongest to make our own func that starts teh DataArray chaining,
					// because this startsWith being *after* we're all the way in DataArray land?  yeah, not efficient.
					// We need to be able to pluck files with certain prefixes out of 10000 files without loading and indexing them all.
					// ...
					// increasingly, I think maybe we just... don't need or derive much value from DV at all.
					// I'm already not using any of their loading nor swizzling.
					// Letting DV do caching is about the only virtue I see but even that's a bit "hmmm".
					//
					// For offering easy integrations though: oh,
					// gross.  `dv.pagePaths` also still takes a string, not even a list lol.  I'm kinda not okay with that.
					// At first I was thinking "we can just offer a func that transforms date ranges into a list of file loading patterns",
					// but... a stringconcat of those?  Really?  Really?
					// The alternative is diving deeper and offering a function that glues together DV's `DataArray.from` and flatmaps that over `dv.page` and so on and so on.
					// Possible.  But would definitely require us to have import their package to do that stuff, and I'm... oof.  I'm Unsure.
					//
					// DOn't forget you still have the much, much simpler option of just calling `dv.pages` repeatedly and then conjoining it.
					// That DOES strongly push you to use folders per day, though.
					// So I guess we should do that and come back to the rest later.

					// Still going to have to have to call `page` (not `pages`) with specific targets to handle getting Tzch events.
					// 
					// Wonder if doing two months is actually just shrug for scale.  Probably is.

					// The other tiebreaker here is: moving a bunch of files in per-day dirs up one as a migration is trivial.
					// Adding another layer of dirs requires bothering to write code.
					//
					// Also i'm pretty sure obsidian itself is indexing at least all filenames proactively.  So it's free to look at that.
					.where((p: DVT_Record) => String(p.file.name).startsWith("evt-"))

				let results: EventInput[] = []
				for (let i in pages.array()) {
					// We're gonna read the frontmatter because it's least wild.
					let evtFmRaw = pages[i].file.frontmatter

					// Quick check first.
					if (!evtFmRaw["evtDate"]) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						continue
					}

					// Use HCEvent to do a parse.
					// An HCEvent is something you can produce unconditionally:
					// it just might contain data that's flagged as not valid.
					let hcEvt = HCEvent.fromFrontmatter(evtFmRaw);
					let hcEvtErr = hcEvt.validate();
					if (hcEvtErr) {
						// TODO use filemanager.processFrontMatter to write an "hcerror" field with message.
						console.log("conversion error:", hcEvtErr);
						continue
					}

					// console.log(hcEvt, hcEvt.getCompleteStartDt().toISO());
					results.push({
						id: pages[i].file.path,
						title: hcEvt.title.valueRaw,
						// Turn our three-part time+date+timezone info into a single string we'll pass to FullCalendar.
						// This is going to *lose precision* -- FC can't actually usefully handle the TZ info.
						// (We'll diligently re-attach and persist TZ data every time we get any info back from FC.)
						start: hcEvt.getCompleteStartDt().toISO() as string,
						end: hcEvt.getCompleteEndDt().toISO() as string,
					})
				}

				successCallback(results)
				//console.log("---- query journey ended")
				return null
			},
			color: '#146792',
		},
	]

	async onOpen() {
		// The first element in containerEl is obsidian's own header.
		// The second is the content div you're expected to use for most content.
		this.viewContentEl = this.containerEl.children[1];
		this.viewContentEl.empty();
		this.viewContentEl.createEl("h4", { text: "Horizon Calendar" });
		this.calUIEl = this.viewContentEl.createEl("div", { cls: "horizoncal" });
		this._doCal();
	}

	async onPaneMenu(menu: Menu) {
		menu.addItem((item) => {
			item
				.setTitle("BONK FULLCAL 👈")
				.setIcon("document")
				.onClick(async () => {
					this._doCal();
				});
		});
	}

	async onResize() {
		this.calUI.render() // `updateSize()` might be enough, but, abundance of caution.
	}

	async onClose() {
		// Problematic: this thing is reattaching its stylesheet repeatedly, and it's not deleting that again.
		console.log("hc view closed", this);
		if (this.calUI) this.calUI.destroy()
	}

	_doCal() {
		if (this.calUI) this.calUI.destroy();

		// This change hook function is used for both fullcal's `eventDrop` and `eventResize` callbacks.
		// They're very similar, except the resize callback gets two different delta values in its info param.
		// They both have old and new events, though, and those both have start and end times,
		// and since we based all our logic on that rather than deltas, we get to reuse the function completely for both.
		let changeHook = async (info: EventDropArg | EventResizeDoneArg) => {
			// Step one: figure out what file we want to update for this.
			// Or, balk immediately if we can't figure it out somehow.
			if (!info.event.id) {
				alert("cannot alter that event; no known data source");
				info.revert()
				return
			}
			let file = this.plugin.app.vault.getAbstractFileByPath(info.event.id)
			if (!file || !(file instanceof TFile)) {
				alert("event id did not map to a file path!");
				info.revert()
				return
			}

			// Step two: we'll use the fileManager to do an update of the frontmatter.
			// (This handles a lot of serialization shenanigans for us very conveniently.)
			let hcEvt: HCEvent;
			await this.plugin.app.fileManager.processFrontMatter(file, (fileFm: any): void => {
				// Parse the existing frontmatter, as a precursor to being ready to save it with modifications.
				// And also because we need the timezone info.
				// (Some of this work may be mildly excessive, but it achieves a lot of annealing of data towards convention.)
				hcEvt = HCEvent.fromFrontmatter(fileFm)

				// TODO some validity checks are appropriate here.
				// f.eks. if timezone strings aren't valid, this is gonna go south from here.

				// Shift the dates we got from fullcalendar back into the timezones this event specified.
				//  Fullcalendar doesn't retain timezones -- it flattens everything to an offset only (because javascript Date forces that),
				//   and it also shifts everything to the calendar-wide tz offset.  This is quite far from what we want.
				let newStartDt = toLuxonDateTime(info.event.start as Date, this.calUI).setZone(hcEvt.evtTZ.valueParsed)
				let newEndDt = toLuxonDateTime(info.event.end as Date, this.calUI).setZone(hcEvt.endTZ.valueParsed || hcEvt.evtTZ.valueParsed)

				// Stir our updated dates into the data.
				// This roundtrips things through strings, which... may seem unnecessary?
				// But on the other hand, that's what we really store, and being literal is good.
				// (Also, I was too lazy to introudce a "setParsed" system to Control; it would require an alternative simplify func, and how we're building the whole magma burrito family; no.)
				hcEvt.evtDate.update(newStartDt.toFormat("yyyy-MM-dd"))
				hcEvt.evtTime.update(newStartDt.toFormat("HH:mm"))
				hcEvt.endDate.update(newEndDt.toFormat("yyyy-MM-dd"))
				hcEvt.endTime.update(newEndDt.toFormat("HH:mm"))

				// Now foist the event structure back into frontmatter form... mutating the object we started with.
				hcEvt.foistFrontmatter(fileFm);

				// Persistence?
				// It's handled magically by processFrontMatter as soon as this callback returns:
				//  it persists our mutations to the `fileFm` argument.
			});

			// Step three: decide if the filename is still applicable or needs to change -- and possibly change it!
			// If we change the filename, we'll also change the event ID.
			let path = HCEventFilePath.fromEvent(hcEvt!);
			let wholePath = path.wholePath;
			if (wholePath != info.event.id) {
				console.log("moving to", wholePath)
				try {
					// Wrapped in a `try` because it throws on "already exists".
					// TODO bother to react better to other errors.
					await this.plugin.app.vault.createFolder("sys/horizoncal/" + path.dirs)
				} catch { }
				await this.plugin.app.fileManager.renameFile(file, "sys/horizoncal/" + wholePath)
				info.event.setProp("id", "sys/horizoncal/" + wholePath)
			}
		}

		this.calUI = new Calendar(this.calUIEl, {
			plugins: [
				// View plugins
				dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin,
				// System glue plugins
				luxonPlugin,
			],
			initialView: 'timeGridFourDay',
			headerToolbar: {
				right: 'prev,next today',
				// future work: additional nav buttons of our own that manage via 'gotoDate' and 'visibleRange'.
				center: 'dayGridMonth,timeGridWeek,timeGridFourDay,timeGrid14Day,listWeek',
				left: 'title',
			},
			views: {
				timeGridFourDay: {
					type: 'timeGrid',
					duration: { days: 4 },
					dateIncrement: { days: 1 },
				},
				timeGrid14Day: {
					type: 'timeGrid',
					duration: { days: 14 },
					dateIncrement: { days: 1 },
				},
			},
			nowIndicator: true,
			// scrollTime: // probably ought to be set so "now" is in it, yo...
			// the 'scrollToTime' method might also be the right thing.
			scrollTimeReset: false,
			height: "auto",
			eventSources: this.eventSources,
			businessHours: {
				daysOfWeek: [1, 2, 3, 4, 5],
				startTime: '09:00',
				endTime: '23:00',
			},
			slotLabelInterval: '1:00',
			slotDuration: '00:30:00',
			snapDuration: '00:15:00',
			// slotLabelFormat: // actually, leaving this unset, because am/pm here is okay... since we use 24hr in the event labels.
			eventTimeFormat: { // like '14:30:00'
				hour: '2-digit',
				minute: '2-digit',
				omitZeroMinute: true,
				hour12: false
			},

			// Dragging?  Spicy.
			editable: true, // Enables the drop and resize callbacks and related UI.
			longPressDelay: 200, // Default is a full second, insanely too long.
			eventDrop: changeHook,
			eventResize: changeHook,
			// dateClick: (info) => {
			// 	// I don't think we have a way to detect "double click".  It's an event registration thing, not a field on the event.
			// 	// On mobile: this does fire.  And it doesn't fire on drag.  So that's good.
			// 	// 'select' might be more what I want, though.
			// 	let dt = toLuxonDateTime(info.date, this.calUI)
			// 	alert("TODO: make new event for " + dt.toFormat("yyyy-MM-dd HH:mm"))
			// },
			selectable: true, // Enables the select callback and related UI.
			// There are some fun params to this like `selectMinDistance` and `selectMirror`, but so far I don't see the appeal of engaging them.
			select: (info) => {
				let startDt = toLuxonDateTime(info.start, this.calUI)
				let endDt = toLuxonDateTime(info.end, this.calUI)

				// Invent some initial "frontmatter" and pop open a modal.
				// The modal will handle further editing, and can persist a new file.
				new NewEventModal(this, HCEvent.fromFrontmatter({
					title: "untitled",
					evtType: "default",
					evtDate: startDt.toFormat("yyyy-MM-dd"),
					evtTime: startDt.toFormat("HH:mm"),
					evtTZ: startDt.zoneName,
					endDate: endDt.toFormat("yyyy-MM-dd"),
					endTime: endDt.toFormat("HH:mm"),
					endTZ: endDt.zoneName,
				})).open();
			},
		})
		this.calUI.render()
	}
}


import { Control } from "./datacontrol";

export class NewEventModal extends Modal {
	constructor(parentView: HorizonCalView, data: HCEvent) {
		super(parentView.plugin.app);
		this.data = data;
		this.parentView = parentView;
	}

	parentView: HorizonCalView;
	data: HCEvent;

	onOpen() {
		this._defragilify();
		this._style();

		let { contentEl } = this;
		contentEl.createEl("h1", { text: "New event" });

		let widgeteer = <TParsed>(params: {
			// Consider it constrained that "TParsed as DateTime, when type=='date'".
			// (I think that could be done with a sufficiently massive union type,
			// but I'm not really sure it's worth it :))
			// (... huh, ends up not mattering, because we successfully only handle raws here.  nice.)
			prop: Control<string | undefined, TParsed>
			name: string
			desc?: string
			type: "text" | "date" | "time" | "toggle"
		}) => {
			let setting = new Setting(contentEl)
			setting.setName(params.name)
			switch (params.type) {
				case "text":
					setting.addText((comp) => comp
						.setValue(params.prop.valueRaw!)
						.onChange((value) => {
							let err = params.prop.tryUpdate(value)
							if (err) {
								// TODO visually highlight as invalid
							}
						}));
					break;
				case "date":
					setting.controlEl.createEl("input",
						// Unfortunate fact about date elements: they use the brower's locale for formatting.
						// I don't know how to control that in electron.  I don't think it's possible.
						// (I appreciate the user-choice _concept_ there, but in practice... system locale is a PITA to control and I don't think this plays out in the user's favor in reality.)
						{ type: "date", value: params.prop.valueRaw },
						(el) => {
							el.addEventListener('change', () => {
								let err = params.prop.tryUpdate(el.value)
								if (err) {
									// TODO visually highlight as invalid
								}
							});
						});
					break;
				case "time":
					setting.controlEl.createEl("input",
						{ type: "time", value: params.prop.valueRaw },
						(el) => {
							el.addEventListener('change', () => {
								let err = params.prop.tryUpdate(el.value)
								if (err) {
									// TODO visually highlight as invalid
								}
							});
						});
					break;
				case "toggle":
					break;
			}
		};

		widgeteer({
			prop: this.data.title, // TODO okay wasn't really planning to Control'ify EVERYTHING but... it makes mutation widget wiring easier too.
			name: "Title",
			type: "text",
		});

		widgeteer({
			// Leaving evtType as freetext for now, but
			// want to introduce a more complex feature here,
			// probably with a sub-modal.
			// May also turn into a set that's persisted as comma-sep strings.
			prop: this.data.evtType, // TODO okay wasn't really planning to Control'ify EVERYTHING but... it makes mutation widget wiring easier too.
			name: "Event Type",
			type: "text",
		});

		// FUTURE: we might wanna do some custom style around date and time things..
		// The date related stuff should have reduced borders and margins between them.
		// (Timezone might also deserve a fold to hide it, but I don't know how to do that with graceful accessibility yet.)
		// (Timezone might ALSO deserve an autocomplete widget of some kind, but that's also beyond me today.)
		widgeteer({
			prop: this.data.evtDate,
			name: "Event Date",
			type: "date",
		});
		widgeteer({
			prop: this.data.evtTime,
			name: "Event Time",
			type: "time",
		});
		widgeteer({
			prop: this.data.evtTZ,
			name: "Timezone",
			type: "text",
		});

		// And now again, the date and time and zone stuff, for ending.
		widgeteer({
			prop: this.data.endDate,
			name: "Event End Date",
			type: "date",
		});
		widgeteer({
			prop: this.data.endTime,
			name: "Event End Time",
			type: "time",
		});
		widgeteer({
			prop: this.data.endTZ,
			name: "Event End Timezone",
			type: "text",
		});

		new Setting(contentEl)
			.addButton(btn => {
				btn.setIcon("checkmark");
				btn.setTooltip("Save");
				btn.onClick(async () => {
					await this._onSubmit();
					this.close();
				});
				return btn;
			})
			.addButton(btn => {
				btn.setIcon("cross");
				btn.setTooltip("Cancel");
				btn.onClick(() => {
					this.close();
				});
				return btn;
			});
	}

	_defragilify() {
		// Remove the background div with a click handler that closes the modal.
		// Closing modals accidentally with a stray click should not be so easy;
		// as a user, I very _very_ rarely want the majority of clickable screen area
		// to turn into a "silently throw away my data" action.
		//
		// If there were more params provide to `onClose` that we could disambiguate close types,
		// and possibly prompt for confirmation, I would have less beef.
		// Since there's not: yeah, nuke this entire trap.
		//
		// Fortunately, the handler we want to get rid of is on its entire own node.
		// It appears to always be the first child, but we'll do a class check
		// just to be on the safe side.
		for (var i = 0; i < this.containerEl.children.length; i++) {
			let child = this.containerEl.children[i];
			if (child.hasClass("modal-bg")) { child.remove() }
		}
	}
	_style() {
		// I have capricious opinions.
		this.modalEl.setCssStyles({ border: "2px solid #F0F" })
		// We need *some* background color on the container, because we nuked the default fadeout during defragilify.
		// The default would be more like `{ backgroundColor: "var(--background-modifier-cover)" }`, but let's have some fun anyway.
		this.containerEl.setCssStyles({ backgroundColor: "#000022cc" })
	}
	async _onSubmit() {
		// FIXME are you sure it's valid? :D

		let path = HCEventFilePath.fromEvent(this.data);

		let file = await this.app.vault.create("sys/horizoncal/" + path.wholePath, "")

		await this.app.fileManager.processFrontMatter(file, (fileFm: any): void => {
			this.data.foistFrontmatter(fileFm);
			// Persistence?
			// It's handled magically by processFrontMatter as soon as this callback returns:
			//  it persists our mutations to the `fileFm` argument.
		});

		// TODO: bonk some UI refreshes!
	}

	onClose() {
		let { contentEl } = this;

		// No persistence unless you clicked our submit button.
		//
		// We made considerable effort to make sure accidental modal dismissal
		// is unlikely even on desktop (which by default is otherwise a bit treacherous),
		// so dropping data when we get here seems safe and reasonable to do.
		contentEl.empty();
	}
}
