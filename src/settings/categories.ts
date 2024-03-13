
import {
	HexString,
	Modal
} from 'obsidian';

// (I don't understand why I have to put that `| undefined` in there, but if I don't,
// typescript will happily let me index into the thing and it _assumes_ the key was present...
// which lets one accidentally skip out on a whole bunch of checks that _will_ hurt at runtime.)
export type EventCategorySettings = {[key: CategoryName]: EventCategoryProperties | undefined};

export type CategoryName = string;

export type EventCategoryProperties = {
	// Categories are stored in event files in tag-like strings of the form "#evt/{catname}".
	// This string is just the trailing part.
	//name: string; // jk, use map keys.

	// Color associated with this category.
	// Generally becomes the event background (although this may depend on other view settings).
	color?: HexString;

	// Opacity can be used to mark tentative events, or cancelled events
	// (or whatever else you prefer to configure).
	//
	// The number should be as a percentage, and is only available in steps of 10.
	// (Setting opacity to "2" will result in 10%; "45" will result in 40%; "400" will cut off at 80%.)
	opacity?: number;

	// An effect priority can be set to disambiguate which category gets its styling applied when an event has several.
	//
	// For example, an "urgent" event getting its red styling applied is probably more important
	// than any other categories that event might also ahve.
	//
	// A higher number gets higher precedence.
	effectPriority?: number;

	// Will we support support arbitrary CSS strings, in addition to the above?  No, I don't think so.
	// But we can add classes that are munges of your category name, so you can use additional stylesheets
	//  if you're really certain you want to be so bold.
	// ... Oh, yeah, definitely. Turns out fullcal doesn't give us an option to do style strings.  Just classes.
}

// This is a modal (rather than a settings tab) because we let you trigger it from the category selector, too.
// (It's a terribly deep modal stack, if the user chooses to do that, but they can do it.)
export class CategoriesManagementModal extends Modal {
	// TODO entirely.
}
