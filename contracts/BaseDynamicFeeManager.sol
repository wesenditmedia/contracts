// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "./EmergencyGuard.sol";
import "./interfaces/IWeSenditToken.sol";

/**
 * @title Base Dynamic Fee Manager
 */
abstract contract BaseDynamicFeeManager is
    IDynamicFeeManager,
    EmergencyGuard,
    AccessControlEnumerable,
    Ownable,
    ReentrancyGuard
{
    // Role allowed to do admin operations like adding to fee whitelist, withdraw, etc.
    bytes32 public constant ADMIN = keccak256("ADMIN");

    // Role allowed to bypass fees
    bytes32 public constant FEE_WHITELIST = keccak256("FEE_WHITELIST");

    // Role allowed to token be sent to without fee
    bytes32 public constant RECEIVER_FEE_WHITELIST =
        keccak256("RECEIVER_FEE_WHITELIST");

    // Role allowed to bypass swap and liquify
    bytes32 public constant BYPASS_SWAP_AND_LIQUIFY =
        keccak256("BYPASS_SWAP_AND_LIQUIFY");

    // Role allowed to bypass wildcard fees
    bytes32 public constant EXCLUDE_WILDCARD_FEE =
        keccak256("EXCLUDE_WILDCARD_FEE");

    // Fee percentage limit
    uint256 public constant FEE_PERCENTAGE_LIMIT = 10000; // 10%

    // Transaction fee limit
    uint256 public constant TRANSACTION_FEE_LIMIT = 10; // 10%

    // Fee divider
    uint256 internal constant FEE_DIVIDER = 100000;

    // Wildcard address for fees
    address internal constant WHITELIST_ADDRESS =
        0x000000000000000000000000000000000000dEaD;

    // List of all currently added fees
    FeeEntry[] internal _fees;

    // Mapping id to current liquify or swap amounts
    mapping(bytes32 => uint256) internal _amounts;

    // Fees enabled state
    bool private _feesEnabled = false;

    // Pancake Router address
    IPancakeRouter02 private _pancakeRouter =
        IPancakeRouter02(address(0x10ED43C718714eb63d5aA57B78B54704E256024E));

    // BUSD address
    address private _busdAddress;

    constructor() {
        // Add creator to admin role
        _setupRole(ADMIN, _msgSender());

        // Set role admin for roles
        _setRoleAdmin(ADMIN, ADMIN);
        _setRoleAdmin(FEE_WHITELIST, ADMIN);
        _setRoleAdmin(RECEIVER_FEE_WHITELIST, ADMIN);
        _setRoleAdmin(BYPASS_SWAP_AND_LIQUIFY, ADMIN);
        _setRoleAdmin(EXCLUDE_WILDCARD_FEE, ADMIN);
    }

    /**
     * Getter & Setter
     */
    function getFee(uint256 index)
        public
        view
        override
        returns (FeeEntry memory fee)
    {
        return _fees[index];
    }

    function getFeeAmount(bytes32 id) public view returns (uint256 amount) {
        return _amounts[id];
    }

    function feesEnabled() public view override returns (bool) {
        return _feesEnabled;
    }

    function setFeesEnabled(bool value) public override onlyRole(ADMIN) {
        _feesEnabled = value;
    }

    function pancakeRouter()
        public
        view
        override
        returns (IPancakeRouter02 value)
    {
        return _pancakeRouter;
    }

    function setPancakeRouter(address value) public override onlyRole(ADMIN) {
        _pancakeRouter = IPancakeRouter02(value);
        emit PancakeRouterUpdated(value);
    }

    function busdAddress() public view override returns (address value) {
        return _busdAddress;
    }

    function setBusdAddress(address value) public override onlyRole(ADMIN) {
        _busdAddress = value;
        emit BusdAddressUpdated(value);
    }

    function emergencyWithdraw(uint256 amount) public override onlyRole(ADMIN) {
        super._emergencyWithdraw(amount);
    }

    function emergencyWithdrawToken(address token, uint256 amount)
        public
        override
        onlyRole(ADMIN)
    {
        super._emergencyWithdrawToken(token, amount);
    }
}
