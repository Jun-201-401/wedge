package com.wedge.discovery.api;

import com.wedge.common.response.ApiResponse;
import com.wedge.common.security.WedgePrincipal;
import com.wedge.discovery.api.dto.CreateDiscoveryRequest;
import com.wedge.discovery.api.dto.DiscoveryResponse;
import com.wedge.discovery.application.DiscoveryService;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/discoveries")
@RequiredArgsConstructor
public class DiscoveryController {
    private final DiscoveryService discoveryService;

    @PostMapping
    public ResponseEntity<ApiResponse<DiscoveryResponse>> createDiscovery(
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
            @Valid @RequestBody CreateDiscoveryRequest request,
            Authentication authentication
    ) {
        return ApiResponse.accepted(discoveryService.createDiscovery(request, principal(authentication).userId(), idempotencyKey));
    }

    @GetMapping("/{discoveryId}")
    public ResponseEntity<ApiResponse<DiscoveryResponse>> getDiscovery(
            @PathVariable UUID discoveryId,
            Authentication authentication
    ) {
        return ApiResponse.ok(discoveryService.getDiscovery(discoveryId, principal(authentication).userId()));
    }

    private WedgePrincipal principal(Authentication authentication) {
        return (WedgePrincipal) authentication.getPrincipal();
    }
}
