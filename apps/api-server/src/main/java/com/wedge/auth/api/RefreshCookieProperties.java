package com.wedge.auth.api;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "wedge.auth.refresh-cookie")
public class RefreshCookieProperties {
    private String path = "/api/auth";
    private String sameSite = "Lax";
    private boolean secure = true;

    public String path() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String sameSite() {
        return sameSite;
    }

    public void setSameSite(String sameSite) {
        this.sameSite = sameSite;
    }

    public boolean secure() {
        return secure;
    }

    public void setSecure(boolean secure) {
        this.secure = secure;
    }
}
