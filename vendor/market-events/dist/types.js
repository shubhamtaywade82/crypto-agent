export function validateEventCausality(event) {
    if (event.availableAtIndex < event.originIndex) {
        throw new Error(`Causal violation: availableAtIndex (${event.availableAtIndex}) < originIndex (${event.originIndex}) in ${event.id}`);
    }
    if (event.availableAtTimestamp < event.originTimestamp) {
        throw new Error(`Causal violation: availableAtTimestamp (${event.availableAtTimestamp}) < originTimestamp (${event.originTimestamp}) in ${event.id}`);
    }
    if (event.timeline) {
        const t = event.timeline;
        if (t.formedAtIndex !== undefined && t.formedAtIndex < t.originIndex) {
            throw new Error(`Causal violation: formedAtIndex (${t.formedAtIndex}) < originIndex (${t.originIndex}) in ${event.id}`);
        }
        if (t.formedAtIndex !== undefined && t.confirmedAtIndex !== undefined && t.confirmedAtIndex < t.formedAtIndex) {
            throw new Error(`Causal violation: confirmedAtIndex (${t.confirmedAtIndex}) < formedAtIndex (${t.formedAtIndex}) in ${event.id}`);
        }
        if (t.confirmedAtIndex !== undefined && t.availableAtIndex < t.confirmedAtIndex) {
            throw new Error(`Causal violation: availableAtIndex (${t.availableAtIndex}) < confirmedAtIndex (${t.confirmedAtIndex}) in ${event.id}`);
        }
        if (t.formedAtTimestamp !== undefined && t.formedAtTimestamp < t.originTimestamp) {
            throw new Error(`Causal violation: formedAtTimestamp (${t.formedAtTimestamp}) < originTimestamp (${t.originTimestamp}) in ${event.id}`);
        }
        if (t.formedAtTimestamp !== undefined && t.confirmedAtTimestamp !== undefined && t.confirmedAtTimestamp < t.formedAtTimestamp) {
            throw new Error(`Causal violation: confirmedAtTimestamp (${t.confirmedAtTimestamp}) < formedAtTimestamp (${t.formedAtTimestamp}) in ${event.id}`);
        }
        if (t.confirmedAtTimestamp !== undefined && t.availableAtTimestamp < t.confirmedAtTimestamp) {
            throw new Error(`Causal violation: availableAtTimestamp (${t.availableAtTimestamp}) < confirmedAtTimestamp (${t.confirmedAtTimestamp}) in ${event.id}`);
        }
    }
}
//# sourceMappingURL=types.js.map