# UI state matrix

| Surface      | State                            | Required presentation                                      | Available action         |
| ------------ | -------------------------------- | ---------------------------------------------------------- | ------------------------ |
| Popup        | Loading                          | Skeleton/status copy; no false grant state                 | Wait                     |
| Popup        | Unsupported page                 | Explain browser-owned/restricted page                      | Open settings            |
| Popup        | Not granted                      | Exact origin, provider state, session vs persistent choice | Allow tab / always allow |
| Popup        | Granted session                  | Green authority tag and tab-only copy                      | Revoke                   |
| Popup        | Granted persistent               | Green authority tag and persistence copy                   | Revoke                   |
| Popup        | Provider missing                 | Amber status; permission decision remains distinct         | Open settings            |
| Popup        | Error/disconnected               | Inline error plate, preserve origin if known               | Retry / settings         |
| Approval     | Pending                          | Origin, alias, mode, scopes, reason, duration              | Deny / allow             |
| Approval     | Busy                             | Lock buttons and label progress                            | Wait                     |
| Approval     | Expired                          | Explain no authority was granted                           | Close                    |
| Approval     | Denied                           | Confirmation without blame                                 | Close                    |
| Options      | Loading                          | Stable shell with loading label                            | Wait                     |
| Options      | Empty profile                    | Guided provider/profile form                               | Configure                |
| Options      | Invalid endpoint/key/alias       | Field-local message plus save summary                      | Correct                  |
| Options      | Settings unchanged               | Save bar fully off-screen and not focusable                | Continue                 |
| Options      | Dirty                            | High-contrast save bar enters from below                   | Save                     |
| Options      | Saving/saved                     | Locked progress; saved receipt exits after 2.4 seconds     | Wait / continue          |
| Options      | Model catalog idle               | Profile-local pull affordance; manual IDs remain available | Pull models              |
| Options      | Model catalog loading            | Busy label and disabled repeat action                      | Wait                     |
| Options      | Model catalog ready              | Bounded model selector and alias action                    | Use model / refresh      |
| Options      | Model catalog empty/error        | Safe explanation without provider body or credential       | Retry / use manual ID    |
| Options      | Audit empty                      | Explain what will appear and retention                     | Continue                 |
| Sample agent | Extension absent                 | Installation/setup guidance                                | Retry                    |
| Sample agent | Permission needed                | Page guidance only; extension owns consent                 | Open extension           |
| Sample agent | Provider missing                 | Link to extension settings                                 | Configure                |
| Sample agent | Streaming                        | Stable transcript, stop control, tool activity             | Cancel                   |
| Sample agent | Tool approval                    | Consequence, input summary, risk                           | Approve / deny           |
| Sample agent | Cancelled/failed/outcome unknown | Structured outcome copy; never model prose                 | Retry if safe            |

All states must work in light and dark themes, at 200% zoom, and without
animation.
