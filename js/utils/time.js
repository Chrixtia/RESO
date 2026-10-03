/**
 * @fileoverview RESO - Time Utilities
 *
 * @description Time parsing and window calculation utilities for determining active automation periods.
 * @author @Chrixtia
 */
/**
 * @function parseTimeToMinutes
 *
 * @description Converts a time string formatted as HH:MM or HH:MM AM/PM into the total number of minutes elapsed from midnight.
 * @param timeStr The input time string to parse.
 * @returns Total minutes from midnight, or null if the string cannot be parsed.
 */
export function parseTimeToMinutes(timeStr) {
    if (!timeStr)
        return null;
    const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)?$/i);
    if (!match)
        return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3];
    if (ampm) {
        if (ampm.toUpperCase() === "PM" && hours < 12)
            hours += 12;
        if (ampm.toUpperCase() === "AM" && hours === 12)
            hours = 0;
    }
    return hours * 60 + minutes;
}
/**
 * @function isWithinTimeWindow
 *
 * @description Evaluates whether the current date and time falls within a specified daily start and end window, supporting overnight intervals.
 * @param startTimeStr The starting boundary of the time window.
 * @param endTimeStr The ending boundary of the time window.
 * @param currentDate Optional reference date to evaluate against, defaulting to the current system time.
 * @returns True if the time is within the active interval or if inputs are missing/invalid, false otherwise.
 */
export function isWithinTimeWindow(startTimeStr, endTimeStr, currentDate = new Date()) {
    if (!startTimeStr || !endTimeStr)
        return true;
    const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
    const startMinutes = parseTimeToMinutes(startTimeStr);
    const endMinutes = parseTimeToMinutes(endTimeStr);
    if (startMinutes === null || endMinutes === null)
        return true;
    if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }
    else {
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
}
