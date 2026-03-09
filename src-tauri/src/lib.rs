mod commands;

use commands::{
    config::{
        approve_feishu_pairing, list_feishu_pairing_requests, list_provider_models,
        login_model_oauth, read_config, read_model_auth_status, read_thinking_default,
        reset_api_runtime, set_thinking_default, switch_active_model, write_config,
    },
    gateway::{
        diagnose_runtime, disable_feishu_doc_tool, disable_memory_search, get_gateway_status,
        lock_plugin_allowlist, quarantine_workspace_prompts, repair_gateway_service,
        reset_feishu_sessions, restart_gateway, run_doctor, run_doctor_fix, run_full_diagnosis,
        run_full_fix, start_gateway, stop_gateway, tighten_state_permissions,
    },
    install::{check_openclaw_installed, install_openclaw, uninstall_openclaw, update_openclaw},
    logs::{
        get_token_optimization_report, get_token_usage, run_token_audit, run_token_treatment,
        test_feishu_connection,
    },
    skills::{get_installed_skills, install_skill, list_available_skills, uninstall_skill},
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").expect("no main window");

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{
                    apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                };
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                )
                .ok();
            }

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_gateway_status,
            start_gateway,
            stop_gateway,
            restart_gateway,
            run_full_diagnosis,
            run_full_fix,
            disable_memory_search,
            disable_feishu_doc_tool,
            lock_plugin_allowlist,
            tighten_state_permissions,
            repair_gateway_service,
            diagnose_runtime,
            reset_feishu_sessions,
            quarantine_workspace_prompts,
            run_doctor,
            run_doctor_fix,
            check_openclaw_installed,
            install_openclaw,
            uninstall_openclaw,
            update_openclaw,
            read_config,
            read_model_auth_status,
            list_provider_models,
            read_thinking_default,
            write_config,
            reset_api_runtime,
            set_thinking_default,
            login_model_oauth,
            switch_active_model,
            list_feishu_pairing_requests,
            approve_feishu_pairing,
            get_installed_skills,
            list_available_skills,
            install_skill,
            uninstall_skill,
            get_token_usage,
            get_token_optimization_report,
            run_token_audit,
            run_token_treatment,
            test_feishu_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
