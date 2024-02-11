import {
	App,
	ItemView,
	Modal,
	Plugin, PluginSettingTab, Setting,
	WorkspaceLeaf
} from 'obsidian';

interface HorizonCalSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: HorizonCalSettings = {
	mySetting: 'default'
}

const VIEW_TYPE = "horizoncal-view";

export default class HorizonCalPlugin extends Plugin {
	settings: HorizonCalSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Open Horizon Calendar', (evt: MouseEvent) => {
			//new Notice('This is a notice!');
			this.activateView();
		});
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// Views!  This is what I'm here for.
		this.registerView(
			VIEW_TYPE,
			(leaf) => new HorizonCalView(leaf)
		);

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new HorizonCalSettingsTabMain(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// All the function names above are magical.

	async activateView() {
		const { workspace } = this.app;
	  
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE);
	  
		if (leaves.length > 0) {
		  // A leaf with our view already exists, use that
		  leaf = leaves[0];
		} else {
		  // Our view could not be found in the workspace, create a new leaf
		  // in the right sidebar for it
		  // TODO this is... not what I want.  What's the "main" leaf?
		  leaf = workspace.getRightLeaf(false);
		  await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
	  
		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	    }
}

export class HorizonCalView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
	  super(leaf);
	}
    
	getViewType() {
	  return VIEW_TYPE;
	}
    
	getDisplayText() {
	  return "This is the hovertext on the icon.";
	}
    
	async onOpen() {
	  const container = this.containerEl.children[1];
	  container.empty();
	  container.createEl("h4", { text: "Example view" });
	  const {FullCalendar} = customJS;
	  container.createEl("span", { text: "lol"+FullCalendar });
	  const rootNode = container.createEl("div");

	  var fc = FullCalendar.bonk()
	  var cal = new fc.Calendar(rootNode, {
		  //plugins: [fc.timegrid], // not when vendorstyle apparently.
		  initialView: 'timeGridFourDay',
		  views: {
			  timeGridFourDay: {
				  type: 'timeGrid',
				  duration: { days: 12 }
			  },
		  },
		  eventSources: [
			  {
				  events: [
					  {
						  title: 'Event1',
						  start: '2024-02-11'
					  },
					  {
						  title: 'Event2',
						  start: '2024-02-11T12:30:00',
						  end: '2024-02-11T13:30:00'
					  }
				  ],
				  color: 'yellow',   // an option!
				  textColor: 'black' // an option!
			  }
		  ],
	  })
	  cal.render()
	}
    
	async onClose() {
	  // Nothing to clean up.
	}
    }
    

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!  Really.');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class HorizonCalSettingsTabMain extends PluginSettingTab {
	plugin: HorizonCalPlugin;

	constructor(app: App, plugin: HorizonCalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
