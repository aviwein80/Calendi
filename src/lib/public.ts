import type { Booking, EventType, Owner, PublicEventType, PublicOwner } from './types';

// Trims database rows down to what a visitor's browser is allowed to see.

export function publicOwner(owner: Owner): PublicOwner {
  return {
    name: owner.name,
    welcome_message: owner.welcome_message,
    avatar_url: owner.avatar_url,
    brand_color: owner.brand_color,
  };
}

export function publicEventType(eventType: EventType): PublicEventType {
  return {
    slug: eventType.slug,
    name: eventType.name,
    description: eventType.description,
    duration_minutes: eventType.duration_minutes,
    color: eventType.color,
    location_type: eventType.location_type,
    // A meeting link stays private until someone has actually booked.
    location_value: eventType.location_type === 'in_person' ? eventType.location_value : '',
    questions: eventType.questions,
    allow_guests: eventType.allow_guests,
    max_days_ahead: eventType.max_days_ahead,
  };
}

/** True once a booking's start time has passed (it can no longer be changed online). */
export function hasStarted(booking: Pick<Booking, 'start_at'>): boolean {
  return booking.start_at.getTime() <= Date.now();
}
