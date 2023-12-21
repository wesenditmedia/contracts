// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IRewardDistributor {
    /**
     * Emitted when claimable token are added for an user
     *
     * @param user address - User address
     * @param amount uint256 - Added token amount
     */
    event TokenAdded(address indexed user, uint256 amount);

    /**
     * Emitted when token are claimed by an user
     *
     * @param user address - User address
     * @param amount uint256 - Claimed token amount
     */
    event TokenClaimed(address indexed user, uint256 amount);

    /**
     * Emitted when token of an user are slayed
     *
     * @param user address - User address
     * @param amount uint256 - Slayed token amount
     */
    event TokenSlayed(address indexed user, uint256 amount);

    /**
     * Returns the amount of claimable token for an user
     *
     * @param user address - User address
     */
    function claimableToken(
        address user
    ) external view returns (uint256 amount);

    /**
     * Returns the amount of claimed token for an user
     *
     * @param user address - User address
     */
    function claimedToken(address user) external view returns (uint256 amount);

    /**
     * Returns the amount of slayed token for an user
     *
     * @param user address - User address
     */
    function slayedToken(address user) external view returns (uint256 amount);

    /**
     * Returns the timestamp of last user claim
     *
     * @param user address - User address
     */
    function lastClaimedAt(
        address user
    ) external view returns (uint256 timestamp);

    /**
     * Returns the timestamp of last user token slay
     *
     * @param user address - User address
     */
    function lastSlayedAt(
        address user
    ) external view returns (uint256 timestamp);

    /**
     * Returns the amount of fees collected
     */
    function totalFees() external view returns (uint256 amount);

    /**
     * Adds claimable token for an user
     *
     * @param user address - User address
     * @param amount uint256 - Token amount to add
     */
    function addTokenForUser(address user, uint256 amount) external;

    /**
     * Adds claimable token for multiple users
     *
     * @param users address[] - Users addresses
     * @param amounts uint256[] - Token amounts to add
     */
    function addTokenForUsers(
        address[] memory users,
        uint256[] memory amounts
    ) external;

    /**
     * Claims token for a user (msg.sender)
     */
    function claimToken() external;

    /**
     * Slays / return token for the specified user
     *
     * @param user address - User address
     */
    function slayTokenForUser(address user) external;

    /**
     * Slays / return token for multiple users
     *
     * @param users address - Users addresses
     */
    function slayTokenForUsers(address[] memory users) external;
}
