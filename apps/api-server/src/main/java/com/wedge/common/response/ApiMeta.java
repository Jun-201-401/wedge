package com.wedge.common.response;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiMeta(
        String requestId,
        String correlationId,
        String nextCursor,
        Boolean hasMore
) {
    public static ApiMeta of(String requestId, String correlationId) {
        return new ApiMeta(requestId, correlationId, null, null);
    }

    public static ApiMeta page(String requestId, String correlationId, String nextCursor, Boolean hasMore) {
        return new ApiMeta(requestId, correlationId, nextCursor, hasMore);
    }
}
