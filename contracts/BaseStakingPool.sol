// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

import "./StakingPoolSnapshot.sol";
import "./EmergencyGuard.sol";
import "./interfaces/IStakingPool.sol";
import "./utils/WeSenditMath.sol";
import "./utils/Trigonometry.sol";
import "./interfaces/IWeStakeitToken.sol";

import "hardhat/console.sol";

abstract contract BaseStakingPool is
    IStakingPool,
    StakingPoolSnapshot,
    EmergencyGuard,
    Ownable,
    AccessControlEnumerable,
    ReentrancyGuard
{
    using Arrays for uint256[];
    using Counters for Counters.Counter;

    // Rewards in token per second
    // Calculation: Max. rewards per year (365 days) / 31_536_000 (seconds per year)
    uint256 public constant TOKEN_PER_SECOND = 7654263202075702075;

    // Initial pool token balance
    uint256 internal constant INITIAL_POOL_BALANCE = 120_000_000 ether;

    // Seconds per day
    uint256 internal constant SECONDS_PER_DAY = 86400;

    // Seconds per hour
    uint256 internal constant SECONDS_PER_HOUR = 3600;

    // Claiming interval for non auto-compounding rewards
    uint256 internal _rewardsClaimInterval = 36 * SECONDS_PER_DAY;

    // Indicator, if pool is paused (no stake, no unstake, no claim)
    bool internal _poolPaused = false;

    // Current pool factor, updated on every updatePool() call
    uint256 internal _currentPoolFactor = 100 ether;

    // Timestamp of last block rewards were calculated
    uint256 internal _lastRewardTimestamp;

    // Amount of allocated pool shares
    uint256 internal _allocatedPoolShares;

    // Amount of accured rewards per share, updated on every updatePool() call
    uint256 internal _accRewardsPerShare;

    // Total amount of locked token (excluding rewards)
    uint256 internal _totalTokenLocked;

    // Total sum of staking durations
    uint256 internal _totalDurationLocked;

    // Token used for staking
    IERC20 private _stakeToken = IERC20(address(0));

    // Token used as staking reward
    IWeStakeitToken private _rewardToken = IWeStakeitToken(address(0));

    // Mapping of reward token to staking entry
    mapping(uint256 => PoolEntry) internal _poolEntries;

    // Checks if tokenId owner equals sender
    modifier onlyTokenOwner(uint256 tokenId) {
        require(
            rewardToken().ownerOf(tokenId) == _msgSender(),
            "Staking Pool: Caller is not entry owner"
        );
        _;
    }

    modifier onlyUnpaused() {
        require(
            !poolPaused(),
            "Staking Pool: Pool operations are currently paused"
        );
        _;
    }

    constructor(address stakeTokenAddress, address rewardTokenAddress) {
        _stakeToken = IERC20(stakeTokenAddress);
        _rewardToken = IWeStakeitToken(rewardTokenAddress);
    }

    function setRewardsClaimInterval(uint256 value) external onlyOwner {
        _rewardsClaimInterval = value;
    }

    function setPoolPaused(bool value) external onlyOwner {
        _poolPaused = value;
    }

    function rewardsClaimInterval() public view returns (uint256 value) {
        return _rewardsClaimInterval;
    }

    function poolPaused() public view returns (bool value) {
        return _poolPaused;
    }

    function currentPoolFactor() public view returns (uint256 value) {
        return _currentPoolFactor;
    }

    function lastRewardTimestamp() public view returns (uint256 value) {
        return _lastRewardTimestamp;
    }

    function allocatedPoolShares() public view returns (uint256 value) {
        return _allocatedPoolShares;
    }

    function accRewardsPerShare() public view returns (uint256 value) {
        return _accRewardsPerShare;
    }

    function totalPoolShares() public pure returns (uint256 value) {
        // Total possible shares per year (365 days)
        // Calculation: 120_000_000 * 200.60293% (max APY) * (365/364)
        return 240_723_516 * 1e2;
    }

    function totalTokenLocked() public view returns (uint256 value) {
        return _totalTokenLocked;
    }

    function minDuration() public pure override returns (uint256 duration) {
        return 7;
    }

    function maxDuration() public pure returns (uint256 value) {
        return 364; // 52 weeks
    }

    function compoundInterval() public pure returns (uint256 value) {
        return 730;
    }

    function stakeToken() public view returns (IERC20 value) {
        return _stakeToken;
    }

    function rewardToken() public view returns (IWeStakeitToken value) {
        return _rewardToken;
    }

    function poolBalance() public view returns (uint256 value) {
        return poolBalance(currentPoolFactor());
    }

    function poolBalance(
        uint256 customPoolFactor
    ) public view returns (uint256 value) {
        // Get current pool balance
        uint256 tokenBalance = stakeToken().balanceOf(address(this));

        // Calculate all rewards paid or are claimable until now
        uint256 rewardDebt = allocatedPoolShares() *
            _calculateAccRewardsPerShareCustom(customPoolFactor);

        // Subtract locked token and rewardDebt from actual pool balance
        return tokenBalance - totalTokenLocked() - rewardDebt;
    }

    function poolEntry(
        uint256 tokenId
    ) public view returns (PoolEntry memory entry) {
        return _poolEntries[tokenId];
    }

    function apy(uint256 duration) public view returns (uint256 value) {
        return apy(duration, poolFactor(poolBalance()));
    }

    function apy(
        uint256 duration,
        uint256 factor
    ) public pure returns (uint256 value) {
        return
            WeSenditMath.apy(
                duration,
                factor,
                maxDuration(),
                compoundInterval()
            );
    }

    function apr(uint256 duration) public view returns (uint256 value) {
        return apr(duration, poolFactor(poolBalance()));
    }

    function apr(
        uint256 duration,
        uint256 factor
    ) public pure returns (uint256 value) {
        return WeSenditMath.apr(duration, factor, maxDuration());
    }

    function poolFactor() public view returns (uint256 value) {
        return WeSenditMath.poolFactor(poolBalance());
    }

    function poolFactor(uint256 balance) public pure returns (uint256 value) {
        return WeSenditMath.poolFactor(balance);
    }

    function accRewardsPerShareAt(
        uint256 snapshotId
    ) public view virtual returns (uint256, uint256) {
        return _accRewardsPerShareAt(snapshotId, accRewardsPerShare());
    }

    function currentPoolFactorAt(
        uint256 snapshotId
    ) public view virtual returns (uint256, uint256) {
        return _currentPoolFactorAt(snapshotId, currentPoolFactor());
    }

    function lastRewardTimestampAt(
        uint256 snapshotId
    ) public view virtual returns (uint256, uint256) {
        return _lastRewardTimestampAt(snapshotId, lastRewardTimestamp());
    }

    function _calculateAccRewardsPerShare()
        internal
        view
        returns (uint256 accRewardsPerShare)
    {
        return
            _calculateAccRewardsPerShare(
                lastRewardTimestamp(),
                currentPoolFactor(),
                _accRewardsPerShare
            );
    }

    function _calculateAccRewardsPerShareCustom(
        uint256 customPoolFactor
    ) internal view returns (uint256 accRewardsPerShare) {
        return
            _calculateAccRewardsPerShare(
                lastRewardTimestamp(),
                customPoolFactor,
                _accRewardsPerShare
            );
    }

    function _calculateAccRewardsPerShare(
        uint256 customSecondsSinceLastRewards
    ) internal view returns (uint256 accRewardsPerShare) {
        // Calculate total rewards since lastRewardTimestamp
        uint256 totalRewards = customSecondsSinceLastRewards * TOKEN_PER_SECOND;

        // Multiply rewards with pool factor
        uint256 currentRewards = (totalRewards * currentPoolFactor()) /
            100 ether;

        // Calculate rewards per share
        return currentRewards / totalPoolShares();
    }

    function _calculateAccRewardsPerShare(
        uint256 customLastRewardTimestamp,
        uint256 customPoolFactor,
        uint256 customAccRewardsPerShare
    ) internal view returns (uint256 accRewardsPerShare) {
        // Calculate seconds elapsed since last reward update
        uint256 secondsSinceLastRewards = block.timestamp -
            customLastRewardTimestamp;

        // Calculate total rewards since lastRewardTimestamp
        uint256 totalRewards = secondsSinceLastRewards * TOKEN_PER_SECOND;

        // Multiply rewards with pool factor
        uint256 currentRewards = (totalRewards * customPoolFactor) / 100 ether;

        // Calculate rewards per share
        return customAccRewardsPerShare + (currentRewards / totalPoolShares());
    }

    function _calculateAccRewardsPerShareForSeconds(
        uint256 customSecondsSinceLastRewards,
        uint256 customPoolFactor,
        uint256 customAccRewardsPerShare
    ) internal pure returns (uint256 accRewardsPerShare) {
        // Calculate total rewards since lastRewardTimestamp
        uint256 totalRewards = customSecondsSinceLastRewards * TOKEN_PER_SECOND;

        // Multiply rewards with pool factor
        uint256 currentRewards = (totalRewards * customPoolFactor) / 100 ether;

        // Calculate rewards per share
        return customAccRewardsPerShare + (currentRewards / totalPoolShares());
    }

    /**
     * Validates staking duration
     *
     * @param duration uint256 - Staking duration in days
     */
    function _validateStakingDuration(uint256 duration) internal pure {
        // Check for min. / max. duration
        require(
            duration >= minDuration() && duration <= maxDuration(),
            "Staking Pool: Invalid staking duration"
        );

        // Check for full week
        require(
            duration % 7 == 0,
            "Staking Pool: Staking duration needs to be a full week"
        );
    }

    /**
     * Validates staking amount
     *
     * @param amount uint256 - Amount of token to stake
     */
    function _validateStakingAmount(uint256 amount) internal {
        // Important: check for max. staking amount before transferring token to pool
        require(
            amount <= _calculateMaxStakingAmount(),
            "Staking Pool: Max. staking amount exceeded"
        );

        // CHeck allowance
        uint256 allowance = stakeToken().allowance(_msgSender(), address(this));
        require(allowance >= amount, "Staking Pool: Amount exceeds allowance");

        // Transfer token to pool
        require(
            stakeToken().transferFrom(_msgSender(), address(this), amount),
            "Staking Pool: Failed to transfer token"
        );
    }

    /**
     * Calculates max. staking amount
     *
     * @return maxAmount uint256 - Max. amount of token allowed to stake
     */
    function _calculateMaxStakingAmount()
        internal
        view
        returns (uint256 maxAmount)
    {
        // Get current pool balance
        uint256 balance = poolBalance();

        // Calculate upper limit (= 80% of initial balance)
        uint256 upperLimit = (INITIAL_POOL_BALANCE * 80) / 100;

        if (balance > upperLimit) {
            // If current pool balance is greater than 80% of initial balance, allow up
            // to 1_000_000 token.
            return 1_000_000 ether;
        } else {
            // If current pool balance is below or equal 80% of initial balance, allow up
            // to (1% * pool balance) token
            return (balance * 1) / 100;
        }
    }

    function _calculateHistoricRewards(
        uint256 shares,
        uint256 endTimestamp
    ) internal view returns (uint256 rewards) {
        // Get snapshot values
        (, uint256 lastRewardTimestampSnapshot) = lastRewardTimestampAt(
            endTimestamp
        );
        (, uint256 poolFactorSnapshot) = currentPoolFactorAt(endTimestamp);
        (, uint256 accRewardsPerShareSnapshot) = accRewardsPerShareAt(
            endTimestamp
        );

        // Calculate remaining duration until staking end
        // TODO: handle negative values
        uint256 durationDiff = endTimestamp - lastRewardTimestampSnapshot;

        // Calculate rewards using snapshot values and remaining duration
        return
            shares *
            _calculateAccRewardsPerShareForSeconds(
                durationDiff,
                poolFactorSnapshot,
                accRewardsPerShareSnapshot
            );
    }

    // Emergency functions
    function emergencyWithdraw(uint256 amount) external override onlyOwner {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(
        address token,
        uint256 amount
    ) external override onlyOwner {
        super._emergencyWithdrawToken(token, amount);
    }
}
