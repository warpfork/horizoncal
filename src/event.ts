
import { DateTime, Duration } from 'luxon';

export class HCEvent {
	public event: string
	public title: string
	public date: DateTime       // Shall have only the YYYY-MM-DD component.
	public startTime?: Duration // Shall have only the HH:mm component.
	public endDate?: DateTime   // Shall have only the YYYY-MM-DD component.  If absent, is treated as if set to 'date'.
	public endTime?: Duration   // Shall have only the HH:mm component.
	public allDay?: boolean
	public completed?: boolean
	public cancelled?: boolean
}
