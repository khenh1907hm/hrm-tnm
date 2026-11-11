import { describe, expect, it } from "vitest";
import { isShortMapsLink, parseCoordinates } from "./mapsLink";

describe("maps link", () => {
  it("MAPS_01 reads coordinates from common Google Maps links and plain text", () => {
    expect(parseCoordinates("https://www.google.com/maps/@11.1047123,106.6926456,17z")).toEqual({ lat: 11.104712, lng: 106.692646 });
    expect(parseCoordinates("https://www.google.com/maps/place/VSIP+II/@11.10,106.60,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d11.1047!4d106.6926")).toEqual({ lat: 11.1047, lng: 106.6926 });
    expect(parseCoordinates("https://maps.google.com/?q=11.1047,106.6926")).toEqual({ lat: 11.1047, lng: 106.6926 });
    expect(parseCoordinates("https://www.google.com/maps/search/?api=1&query=11.1047%2C106.6926")).toEqual({ lat: 11.1047, lng: 106.6926 });
    expect(parseCoordinates("https://www.openstreetmap.org/?mlat=11.1047&mlon=106.6926#map=17/11.1/106.6")).toEqual({ lat: 11.1047, lng: 106.6926 });
    expect(parseCoordinates("11.1047, 106.6926")).toEqual({ lat: 11.1047, lng: 106.6926 });
    expect(parseCoordinates("11,1047 106,6926")).toEqual({ lat: 11.1047, lng: 106.6926 });
    expect(parseCoordinates("10.762622, -106.660172")).toEqual({ lat: 10.762622, lng: -106.660172 });
  });

  it("MAPS_01 rejects text without coordinates or out of range, and recognises share short links", () => {
    expect(parseCoordinates("KCN VSIP II Bình Dương")).toBeNull();
    expect(parseCoordinates("https://www.google.com/maps/@95.1,106.6,17z")).toBeNull();
    expect(parseCoordinates("0, 0")).toBeNull();
    expect(isShortMapsLink("https://maps.app.goo.gl/AbCdEf123")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/AbCd")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/other")).toBe(false);
    expect(isShortMapsLink("https://evil.example/maps.app.goo.gl")).toBe(false);
    expect(isShortMapsLink("http://maps.app.goo.gl/x")).toBe(false);
  });
});
