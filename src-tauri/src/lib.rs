mod dumpview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(dumpview::AppState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dumpview::load_dump_payload,
            dumpview::load_sample_dump,
            dumpview::search_symbols,
            dumpview::get_symbol_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
