/**
 * The sample songs that ship with Azimuth (public/samples/). Each is offered on the song screen as
 * "Try a sample": it is fetched and added to the library through the same path as an uploaded file,
 * so it is analysed and stored exactly like the player's own songs. `file` is the name under
 * public/samples/; the displayed name comes from the file name, as for any song.
 */
export const SAMPLE_SONGS: readonly { file: string }[] = [{ file: 'Better by Moonlight.mp3' }, { file: 'ussy poppin (Remastered).mp3' }];
