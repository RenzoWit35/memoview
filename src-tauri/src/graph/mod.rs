mod incremental;
mod index;
mod model;

pub use incremental::{apply_event, bulk_load};
pub use index::GraphIndex;
pub use model::{BacklinkRef, Edge, GraphSnapshot, NoteId};
